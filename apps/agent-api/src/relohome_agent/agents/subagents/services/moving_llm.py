"""Read-only Moving agent: LLM chooses tools, trusted code retains provider facts and route.

Contacts/credentials never enter model context. Results are built from observed MCP outputs,
not from LLM-generated prices/coordinates. Explicit construction only; graph wiring is unchanged.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from time import perf_counter
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from langfuse.openai import AsyncOpenAI
from openai import APIError
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import (
    AgentManifest,
    AgentTaskRequest,
    AgentTaskResult,
    failed_result,
    reject_unsupported,
)
from relohome_agent.agents.llm import LLMError
from relohome_agent.agents.llm_context import model_json
from relohome_agent.agents.llm_provider import client_options, provider_model
from relohome_agent.agents.llm_runtime import Invocation, json_object, public_data
from relohome_agent.agents.models import AgentBudget, AgentName, LocationChoice, Question, Quote, SourceKind
from relohome_agent.agents.subagents.capabilities import RELOCATION
from relohome_agent.agents.subagents.services.location import MIN_SUGGESTION_SCORE, location_choices, to_candidate
from relohome_agent.agents.subagents.services.moving import QuoteContact, order_time, summarize_order
from relohome_agent.agents.subagents.services.moving_catalog import MovingCatalogCache
from relohome_agent.agents.subagents.services.moving_context import (
    compact_selection_catalog,
    selection_catalog_for_model,
    service_details_for_model,
)
from relohome_agent.agents.task_prompts import FORM_SELECTION, MOVING_CORE, MOVING_MODES
from relohome_agent.services.adapters.mcp import McpToolClient, ToolCallError
from relohome_contracts.moving_options import apply_draft_options, service_selection, validated_options

logger = logging.getLogger(__name__)


def function(name: str, description: str, properties: dict | None = None) -> dict:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "strict": True,
        "parameters": {
            "type": "object",
            "properties": properties or {},
            "required": list(properties or {}),
            "additionalProperties": False,
        },
    }


STRING = {"type": "string"}
STRINGS = {"type": "array", "items": STRING}
TOOLS = [
    function(
        "resolve_move_route",
        "Resolve pickup/destination supplied in task using trusted locations. Ask user if ambiguous.",
    ),
    function("list_service_areas", "List real AhaMove service areas."),
    function(
        "list_moving_services", "List available services at the resolved pickup. Resolve route first for a quote."
    ),
    function(
        "get_moving_service",
        "Read details of a service observed in the catalog; no invented IDs.",
        {"service_id": STRING},
    ),
    function(
        "estimate_move",
        "Estimate full trusted route for observed service IDs; at most 3 per call. No bốc xếp assumption.",
        {"service_ids": STRINGS},
    ),
    function("get_move_order", "Read the order_id from the task, not a model-created ID."),
    function(
        "find_move_orders_by_tracking_number",
        "Find orders for the task tracking reference; multiple matches require clarification.",
    ),
    function("get_move_tracking_link", "Get link for an order already observed in this task."),
    function(
        "get_move_order_events",
        "Get event history for the task tracking reference; private raw payload never sent to LLM.",
    ),
    function(
        "finish",
        "Finish after successful reads. Return only observed provider results, optionally order quote options by their observed IDs.",
        {"option_ids": STRINGS},
    ),
    function(
        "ask_user",
        "Return a concise question to the orchestrator when required information cannot be obtained.",
        {"field": STRING, "question": STRING},
    ),
]
TOOL_SCHEMAS = {t["name"]: t["parameters"] for t in TOOLS}
# Moving service error codes meaning "the provider understood the request and refused its content"
# (Moving MCP contract). The agent can explain these and ask the user; other errors (transport,
# credentials, configuration, rate limits) still end the task as failures.
REQUEST_REJECTION_CODES = frozenset(
    {"PROVIDER_REJECTED", "VALIDATION_ERROR", "PROVIDER_NOT_FOUND", "PROVIDER_CONFLICT", "QUOTE_EXPIRED"}
)
# Application payload budget, NOT a model token/context-window guarantee. Count
# the complete serialized UTF-8 request (including escaped input, tools and enums)
# once; separate catalog/context character gates rejected ordinary 19-vehicle
# catalogs before the actual request could be measured. No extra counting API call.
MAX_SELECTION_REQUEST_BYTES = 64_000


class MovingLlmAgent:
    def __init__(
        self,
        api_key: str,
        model: str,
        moving: McpToolClient,
        location: McpToolClient | None = None,
        contact: QuoteContact | None = None,
        *,
        source_kind: SourceKind = "sandbox",
        clock: Callable[[], datetime] = utcnow,
    ):
        self.api_key, self.model, self.moving = api_key, model, moving
        self.location, self.contact, self.source_kind, self.clock = location, contact, source_kind, clock
        self.client: AsyncOpenAI | None = None
        self.catalog_cache = MovingCatalogCache(moving)
        self.capability = RELOCATION.model_copy(deep=True)
        self.capability.uses_llm = True
        self.capability.default_budget = AgentBudget(max_llm_calls=8, max_provider_calls=8)
        self.capability.required_fields = ["quotes|order|cities|services", "quotes[].price_vnd"]
        self.capability.input_schema["properties"]["mode"]["enum"].append("catalog")
        self.capability.input_schema["properties"]["city_id"] = {"type": "string", "minLength": 1}
        coordinate = {
            "type": "object",
            "properties": {
                "lat": {"type": "number", "minimum": -90, "maximum": 90},
                "lng": {"type": "number", "minimum": -180, "maximum": 180},
            },
            "required": ["lat", "lng"],
            "additionalProperties": False,
        }
        for key in ("pickup_coordinate", "destination_coordinate"):
            self.capability.input_schema["properties"][key] = coordinate

    def get_manifest(self) -> AgentManifest:
        return AgentManifest(name="moving-llm", owner="Khoa/AI", capabilities=[self.capability])

    async def close(self):
        if self.client:
            await self.client.close()

    async def run_task(self, request: AgentTaskRequest) -> AgentTaskResult:
        return await self.run(request)

    async def run_form_quote(self, req: AgentTaskRequest) -> AgentTaskResult:
        """Typed UI intent only; chat continues to use the ordinary autonomous loop."""
        return await self.run(req, form_quote=True)

    async def suggest_form_quote(self, execution: MovingExecution) -> AgentTaskResult:
        """One bounded selection, then the existing authoritative batched estimate.

        No model-driven detail-read loop or fallback first-N service selection.
        The provider, not the model or a city allowlist, validates the full route.
        """
        projected = selection_catalog_for_model(execution.catalog)
        catalog = compact_selection_catalog(projected)
        defaults = catalog.get("catalog_defaults", {})
        execution.catalog_selection = {
            "service_count": len(projected),
            "projected_chars": len(model_json(projected)),
            "catalog_chars": len(model_json(catalog)),
            "shared_fact_count": len(catalog.get("catalog_facts", {}))
            + len(defaults.get("constraints", {}))
            + len(set(defaults) - {"constraints"}),
            "catalog_section_chars": {
                key: len(model_json(catalog.get(key, {}))) for key in ("services", "catalog_defaults", "catalog_facts")
            },
            "status": "prepared",
        }
        if not self.api_key or self.api_key.startswith(("your-", "sk-your", "test-")):
            return execution.failed("provider_unavailable", "Chưa cấu hình LLM.")
        ids_schema = {
            "type": "array",
            "items": {"type": "string", "enum": list(execution.catalog)},
            "minItems": 1,
            "maxItems": min(3, len(execution.catalog)),
        }
        estimate = function(
            "estimate_move", "Compare prices for observed vehicles on the confirmed route.", {"service_ids": ids_schema}
        )
        ask = function(
            "ask_user",
            "Ask one necessary question; never invent missing requirements.",
            {
                "field": {"type": "string", "enum": ["service_id", "moving_request"]},
                "question": {"type": "string", "minLength": 1, "maxLength": 350},
            },
        )
        options = execution.req.inputs.get("moving_options") or {}
        context = {
            "goal": execution.req.goal,
            "user_request": execution.req.user_request,
            "load": {
                key: options[key]
                for key in ("packages", "cod", "item_value", "require_pod", "require_verification")
                if key in options
            },
            "volume": execution.req.inputs.get("volume"),
            "schedule": {key: execution.req.inputs[key] for key in ("move_date", "move_time")},
            **catalog,
            "route": "Both stops and schedule confirmed; provider estimate validates serviceability.",
        }
        if options.get("remarks") is not None:
            context["remarks"] = public_data(options["remarks"])
        model_input = model_json(context)
        execution.catalog_selection.update(context_chars=len(model_input))
        tools = [estimate, ask]
        model_request: dict[str, Any] = {
            "model": provider_model(self.api_key, self.model),
            "instructions": FORM_SELECTION,
            "input": [{"role": "user", "content": model_input}],
            "tools": tools,
            "tool_choice": "required",
            "parallel_tool_calls": False,
            "max_output_tokens": 500,
            "store": False,
            **({"reasoning": {"effort": "none"}} if self.model == "gpt-6-luna" else {}),
        }
        # Catalog, custom load/remarks and enum IDs share ONE budget. Measure bytes
        # rather than confusing Vietnamese characters or JSON size with token usage.
        serialized = json.dumps(model_request, ensure_ascii=False, separators=(",", ":"))
        request_bytes = len(serialized.encode("utf-8"))
        execution.catalog_selection.update(
            request_chars=len(serialized),
            request_bytes=request_bytes,
            request_byte_limit=MAX_SELECTION_REQUEST_BYTES,
            tools_chars=len(json.dumps(tools, ensure_ascii=False, separators=(",", ":"))),
            status="request_limit",
        )
        if request_bytes > MAX_SELECTION_REQUEST_BYTES:
            return execution.ask(
                "service_id", "Dữ liệu gợi ý vượt giới hạn an toàn; bạn chọn một gói xe để mình báo giá nhé."
            )
        execution.catalog_selection["status"] = "ready"
        if self.client is None:
            self.client = AsyncOpenAI(api_key=self.api_key, max_retries=0, timeout=45, **client_options(self.api_key))
        execution.run.reserve()
        started = perf_counter()
        try:
            async with asyncio.timeout(execution.run.remaining()):
                response = await self.client.responses.create(**model_request)
        finally:
            execution.llm_ms += (perf_counter() - started) * 1000
        if response.usage:
            execution.run.usage.tokens_in += response.usage.input_tokens
            execution.run.usage.tokens_out += response.usage.output_tokens
        if response.status != "completed":
            return execution.failed("provider_unavailable", "Chưa chọn được gói xe; bạn thử lại hoặc chọn gói xe nhé.")
        calls = [item for item in response.output if item.type == "function_call"]
        schemas = {tool["name"]: tool["parameters"] for tool in (estimate, ask)}
        if len(calls) != 1 or calls[0].name not in schemas:
            return execution.failed("internal", "Kết quả gợi ý gói xe không đúng định dạng.")
        call = calls[0]
        try:
            args = json_object(call.arguments)
            if not Draft202012Validator(schemas[call.name]).is_valid(args):
                raise ValueError("Invalid service selection")
            if call.name == "estimate_move" and len(set(args["service_ids"])) != len(args["service_ids"]):
                raise ValueError("Repeated service selection")
        except (ValueError, TypeError):
            return execution.failed("invalid_input", "Gói xe gợi ý không hợp lệ; bạn chọn một gói xe nhé.")
        execution.tools.append(call.name)
        async with asyncio.timeout(execution.run.remaining()):
            output = await execution.call(call.name, args)
        if isinstance(output, AgentTaskResult):
            return output
        return await execution.finish_form_quote()

    async def run(self, req: AgentTaskRequest, *, form_quote: bool = False) -> AgentTaskResult:
        if rejected := reject_unsupported(req, "ahamove", self.source_kind):
            return rejected
        if req.budget.deadline_at is not None and req.budget.deadline_at.utcoffset() is None:
            return failed_result(
                req, "invalid_input", "deadline_at must include a timezone", False, "ahamove", self.source_kind
            )
        run = Invocation(
            max_calls=min(req.budget.max_llm_calls, 8),
            deadline=min(
                req.budget.deadline_at or self.clock() + timedelta(seconds=120), self.clock() + timedelta(seconds=120)
            ),
        )
        execution = MovingExecution(self, req, run)
        execution.form_quote = form_quote
        try:
            if req.agent != AgentName.RELOCATION:
                return execution.failed("invalid_input", "Task không thuộc Moving.")
            problems = list(
                Draft202012Validator(self.capability.input_schema, format_checker=FormatChecker()).iter_errors(
                    req.inputs
                )
            )
            if problems:
                return execution.ask(
                    "moving_request", "Cần đủ điểm lấy/giao và ngày giờ chuyển, hoặc mã đơn để tra cứu."
                )
            if form_quote:
                if req.inputs.get("mode") != "quote" or not all(
                    req.inputs.get(key) for key in ("pickup_coordinate", "destination_coordinate")
                ):
                    return execution.ask("moving_request", "Hãy xác nhận cả hai điểm trên bản đồ.")
                for operation in ("resolve_move_route", "list_moving_services"):
                    execution.tools.append(operation)
                    async with asyncio.timeout(run.remaining()):
                        prepared = await execution.call(operation, {})
                    if isinstance(prepared, AgentTaskResult):
                        return prepared
                # The user already chose this service. Never ask a model to choose it again.
                selected = (req.inputs.get("moving_options") or {}).get("service_id")
                if selected:
                    if selected not in execution.catalog:
                        return execution.ask(
                            "service_id", "Gói xe đã chọn không còn trong danh mục tại điểm lấy. Hãy chọn lại."
                        )
                    execution.tools.append("estimate_move")
                    async with asyncio.timeout(run.remaining()):
                        priced = await execution.call("estimate_move", {"service_ids": [selected]})
                    if isinstance(priced, AgentTaskResult):
                        return priced
                    return await execution.finish_form_quote()
                return await self.suggest_form_quote(execution)
            if not self.api_key or self.api_key.startswith(("your-", "sk-your", "test-")):
                return execution.failed("provider_unavailable", "Chưa cấu hình LLM.")
            if self.client is None:
                self.client = AsyncOpenAI(
                    api_key=self.api_key, max_retries=0, timeout=45, **client_options(self.api_key)
                )
            mode = req.inputs["mode"]
            allowed = {"ask_user", "finish"}
            if mode == "catalog":
                allowed |= (
                    {"list_moving_services", "get_moving_service"}
                    if req.inputs.get("city_id")
                    else {"list_service_areas"}
                )
            elif mode == "quote":
                allowed |= {"resolve_move_route", "list_moving_services", "get_moving_service", "estimate_move"}
            else:
                allowed |= {
                    "get_move_order",
                    "find_move_orders_by_tracking_number",
                    "get_move_tracking_link",
                    "get_move_order_events",
                }
            history: list[Any] = [
                {
                    "role": "user",
                    "content": model_json(
                        public_data(
                            {
                                "inputs": req.inputs,
                                "goal": req.goal,
                                "user_request": req.user_request,
                                "constraints": req.constraints,
                                "hints": req.hints,
                                "budget": req.budget.model_dump(mode="json"),
                            }
                        ),
                    ),
                }
            ]
            while True:
                # Only offer tools whose prerequisites are met. A completed
                # quote must not start another catalog/quote loop.
                available = set(allowed)
                if execution.rejection is not None:
                    # After a refusal: explain/ask, or try a service not attempted yet.
                    available = {"ask_user"}
                    if mode == "quote" and set(execution.catalog) - execution.tried_services:
                        available.add("estimate_move")
                elif mode == "quote":
                    if execution.quote is not None:
                        available = {"finish"}
                    elif execution.route is None:
                        available = {"resolve_move_route"}
                    elif not execution.catalog_loaded:
                        available = {"list_moving_services"}
                    else:
                        available = {"estimate_move"}
                        if execution.detail_reads < 2:
                            available.add("get_moving_service")
                run.reserve()
                llm_started = perf_counter()
                async with asyncio.timeout(run.remaining()):
                    response = await self.client.responses.create(
                        model=provider_model(self.api_key, self.model),
                        instructions=MOVING_CORE + "\n" + MOVING_MODES[mode],
                        input=history,
                        tools=[t for t in TOOLS if t["name"] in available],
                        tool_choice="required",
                        parallel_tool_calls=False,
                        max_output_tokens=1500,
                        store=False,
                        **({"reasoning": {"effort": "none"}} if self.model == "gpt-6-luna" else {}),
                    )
                execution.llm_ms += (perf_counter() - llm_started) * 1000
                if response.usage:
                    run.usage.tokens_in += response.usage.input_tokens
                    run.usage.tokens_out += response.usage.output_tokens
                if response.status != "completed":
                    return execution.failed("provider_unavailable", "LLM không hoàn thành quyết định tool.")
                calls = [o for o in response.output if o.type == "function_call"]
                if len(calls) != 1:
                    return execution.failed("internal", "LLM phải chọn đúng một tool mỗi bước.")
                history.extend(response.output)
                call = calls[0]
                execution.tools.append(call.name)  # Names only: never record contacts/tool payloads.
                try:
                    args = json_object(call.arguments)
                    if call.name not in available or not Draft202012Validator(TOOL_SCHEMAS[call.name]).is_valid(args):
                        raise ValueError("Tool arguments invalid")
                    async with asyncio.timeout(run.remaining()):
                        output = await execution.call(call.name, args)
                except ValueError:
                    output = {"error": "invalid_tool_arguments_or_unobserved_reference"}
                except (KeyError, TypeError):
                    if form_quote:
                        raise
                    output = {"error": "invalid_tool_arguments_or_unobserved_reference"}
                except ToolCallError as exc:
                    if exc.transport or exc.retryable or exc.code not in REQUEST_REJECTION_CODES:
                        raise
                    execution.rejection = {"tool": call.name, "code": exc.code, "message": exc.message}
                    output = {"provider_rejected": execution.rejection}
                if isinstance(output, AgentTaskResult):
                    return output
                if form_quote and call.name == "estimate_move" and execution.quote is not None:
                    return await execution.finish_form_quote()
                history.append(
                    {
                        "type": "function_call_output",
                        "call_id": call.call_id,
                        "output": model_json(output),
                    }
                )
        except LLMError as exc:
            return execution.failed(
                "budget_exceeded" if exc.code == "LLM_BUDGET" else "timeout",
                exc.message if hasattr(exc, "message") else str(exc),
            )
        except TimeoutError:
            return execution.failed("timeout", "Đã hết thời gian xử lý.", True)
        except ToolCallError as exc:
            if form_quote and not exc.transport and not exc.retryable and exc.code in REQUEST_REJECTION_CODES:
                return execution.ask("moving_request", "AhaMove từ chối báo giá: " + public_data(exc.message)[:400])
            return execution.failed(
                "provider_unavailable" if exc.retryable else "provider_rejected",
                f"Moving tool failed ({exc.code}): {public_data(exc.message)[:400]}",
                exc.retryable,
            )
        except APIError:
            logger.warning("moving agent LLM call failed", exc_info=True)
            return execution.failed("provider_unavailable", "LLM không phản hồi; chưa hoàn thành task.", True)
        except (KeyError, TypeError, ValueError):
            if form_quote:
                raise  # Unexpected form errors must reach the graph callback and HTTP instrumentation.
            logger.warning("moving agent result broke the task contract", exc_info=True)
            return execution.failed("internal", "Dữ liệu trả về không đáp ứng contract; chưa hoàn thành task.")


class FormQuoteAgent:
    """Use the existing form mode without mutating the shared domain agent."""

    def __init__(self, agent: MovingLlmAgent):
        self.agent, self.capability = agent, agent.capability

    async def run(self, request: AgentTaskRequest) -> AgentTaskResult:
        return await self.agent.run_form_quote(request)


class MovingExecution:
    """All mutable state belongs to one request; no thread cache or model-authored facts."""

    def __init__(self, agent: MovingLlmAgent, req: AgentTaskRequest, run: Invocation):
        self.agent, self.req, self.run = agent, req, run
        self.form_quote = False
        self.started = perf_counter()
        self.llm_ms = 0.0
        self.tool_timings: list[dict] = []
        self.route: dict | None = None
        self.catalog: dict[str, dict] = {}
        self.catalog_loaded = False
        self.catalog_selection: dict | None = None
        self.areas: list[dict] | None = None
        self.order: dict | None = None
        self.quote: dict | None = None
        self.cache: dict[str, Any] = {}
        self.detail_reads = 0
        self.selected_listing: dict | None = None
        self.tried_services: set[str] = set()
        self.candidates: dict[str, list[dict]] = {}  # Location results per unresolved address
        self.rejection: dict | None = None  # last provider refusal, shown to the model
        self.tools: list[str] = []

    def result(self, status: str, **kwargs):
        data = dict(kwargs.pop("data", {}))
        data["agent_trace"] = self.trace()
        return AgentTaskResult(
            task_id=self.req.task_id,
            plan_version=self.req.plan_version,
            status=status,
            source="ahamove",
            source_kind=self.agent.source_kind,
            fetched_at=self.agent.clock(),
            usage=self.run.usage.model_copy(),
            data=data,
            **kwargs,
        )

    def ask(self, field: str, question: str):
        return self.result("needs_input", questions=[Question(field=field, text=public_data(question)[:500])])

    def failed(self, code: str, message: str, retryable: bool = False):
        result = failed_result(
            self.req, code, message, retryable, "ahamove", self.agent.source_kind, self.run.usage.model_copy()
        )
        result.data["agent_trace"] = self.trace()
        return result

    def trace(self):
        return {
            "uses_llm": self.run.usage.llm_calls > 0 if self.form_quote else True,
            "mode": "structured-form" if self.form_quote else "conversation",
            "strategy": (
                "explicit-service"
                if (self.req.inputs.get("moving_options") or {}).get("service_id")
                else "single-decision"
                if self.run.usage.llm_calls
                else "form-preparation"
            )
            if self.form_quote
            else "tool-loop",
            "tools": list(self.tools),
            **({"catalog_selection": dict(self.catalog_selection)} if self.catalog_selection is not None else {}),
            "timing": {
                "total_ms": round((perf_counter() - self.started) * 1000),
                "llm_ms": round(self.llm_ms),
                "mcp_tools": list(self.tool_timings),
            },
        }

    async def finish_form_quote(self):
        result = await self.call("finish", {"option_ids": []})
        result.data["agent_completion"] = {
            "mode": "provider_facts",
            "model_assessed": False,
            "scope": "confirmed_form_and_provider_catalog",
        }
        return result

    async def tool(self, client: McpToolClient | None, name: str, args: dict):
        if client is None:
            return None
        key = json.dumps([client.endpoint.service, name, args], sort_keys=True)
        if key in self.cache:
            self.run.usage.cached_calls += 1
            return self.cache[key]
        catalog_read = client is self.agent.moving and name == "list_moving_services"
        if catalog_read:
            self.run.remaining()
            observed = self.agent.catalog_cache.get(args)
            if observed is not None:
                self.run.usage.cached_calls += 1
                self.tool_timings.append({"tool": name, "elapsed_ms": 0, "cache_hit": True})
                self.cache[key] = observed
                return observed
        if self.run.usage.provider_calls >= min(self.req.budget.max_provider_calls, 8):
            raise LLMError("LLM_BUDGET", "Hết ngân sách gọi provider.")
        self.run.remaining()
        self.run.usage.provider_calls += 1
        tool_started = perf_counter()
        try:
            result = await client.call(name, args)
        except ToolCallError:
            if client is self.agent.moving and name in {"list_moving_services", "estimate_move"}:
                self.agent.catalog_cache.clear()
            raise
        finally:
            self.tool_timings.append({"tool": name, "elapsed_ms": round((perf_counter() - tool_started) * 1000)})
        self.cache[key] = result
        if catalog_read:
            self.agent.catalog_cache.put(args, result)
        return result

    async def point(self, address: str, coordinate: dict | None):
        if coordinate:
            return {"address": address, **coordinate}
        resolved = await self.tool(self.agent.location, "resolve_location", {"text": address, "limit": 3})
        if not resolved:
            return None
        rows = resolved.get("results", [])
        self.candidates[address] = rows
        # Dedup can leave one exact POI (including a campus interior or bus stop).
        # A unique name is not a confirmed vehicle stop; the user confirms its pin.
        return None

    def location_question(self, field: str, address: str) -> Question:
        house = None
        if address == "selected:property":
            house = self.selected_house()
            address = (house or {}).get("address") or "căn nhà bạn đã chọn"
        label = "lấy" if field == "from_address" else "giao"
        broad = re.fullmatch(r"\s*(quận|huyện|phường|thành phố|tỉnh)\s+[^,]+\s*", address, flags=re.IGNORECASE)
        if broad:
            text = f"Bạn muốn {label} đồ ở địa chỉ nào trong ‘{address}’? Mình cần số nhà/tên tòa nhà và đường; tên quận/khu vực chưa xác định được điểm xe đến."
        elif any(word in address.casefold() for word in ("ký túc xá", "kí túc xá", "khu b", "khu a")):
            text = f"‘{address}’ là ký túc xá của trường nào, ở thành phố nào và lấy/giao tại cổng nào? Mình chưa xác định được đúng điểm {label}."
        else:
            text = f"Mình đã ghi địa chỉ {label} ‘{address}’, nhưng dữ liệu bản đồ chưa xác định được điểm chính xác. Bạn chọn đúng điểm {label} trên bản đồ (bấm một gợi ý hoặc chạm vào vị trí) để mình báo giá; không cần nhập lại ngày giờ."
        # Candidates Location actually returned; the client shows them as pins to confirm.
        choices = location_choices(
            [
                r
                for r in self.candidates.get(address, [])
                # Same suggestion rule as Housing/Map: real places whose name matches, or a strong fuzzy
                # match; the user still confirms the stop point, nothing is auto-selected.
                if r.get("entity_type") == "place"
                and (r.get("match_type") != "fuzzy" or (r.get("match_score") or 0) >= MIN_SUGGESTION_SCORE)
            ]
        )
        if house and all(house.get(k) is not None for k in ("lat", "lng")):
            choices.append(
                LocationChoice(
                    id=house["id"],
                    label=f"{address} (vị trí gần đúng — cần xác nhận điểm dừng xe)",
                    entity_type="housing",
                    lat=house["lat"],
                    lng=house["lng"],
                )
            )
        return Question(field=field, text=text, choices=choices)

    def selected_house(self) -> dict | None:
        if self.selected_listing:
            return self.selected_listing
        matches = {
            c["id"]: c
            for r in self.req.upstream.values()
            for c in r.data.get("candidates", [])
            if c.get("id") == self.req.inputs.get("selected_listing_id")
        }
        return next(iter(matches.values()), None)

    async def endpoint(self, address: str | None, coordinate: dict | None = None):
        if address and address != "selected:property":
            return await self.point(address, coordinate)
        house = self.selected_house()
        if house is None and self.req.inputs.get("selected_listing_id"):
            item = await self.tool(
                self.agent.location, "get_housing", {"listing_id": self.req.inputs["selected_listing_id"]}
            )
            if item and item.get("listing_id") == self.req.inputs["selected_listing_id"]:
                self.selected_listing, _ = to_candidate(item, [])
                house = self.selected_listing
        if house and house.get("location_accuracy") == "rooftop":
            if all(house.get(k) is not None for k in ("lat", "lng", "address")):
                return {k: house[k] for k in ("lat", "lng", "address")}
        return None

    async def call(self, name: str, args: dict):
        inp, mode = self.req.inputs, self.req.inputs["mode"]
        if name == "ask_user":
            if args["field"] not in {
                "moving_request",
                "from_address",
                "to_address",
                "move_date",
                "move_time",
                "order_id",
                "tracking_number",
                "service_id",
                "city_id",
            }:
                return self.ask("moving_request", "Bạn làm rõ yêu cầu chuyển đồ hoặc mã đơn cần tra cứu nhé.")
            return self.ask(args["field"], args["question"])
        if name == "resolve_move_route":
            if mode != "quote":
                raise ValueError("No quote task")
            when = order_time(inp["move_date"], inp.get("move_time"), self.agent.clock())
            if when is None:
                return self.ask("move_time", "Bạn muốn chuyển ngày nào, lúc mấy giờ trong tương lai?")
            pickup = await self.endpoint(inp["from_address"], inp.get("pickup_coordinate"))
            destination = await self.endpoint(inp.get("to_address"), inp.get("destination_coordinate"))
            if pickup is None or destination is None:
                questions = []
                if pickup is None:
                    questions.append(self.location_question("from_address", inp["from_address"]))
                if destination is None:
                    questions.append(self.location_question("to_address", inp.get("to_address", "phòng đã chọn")))
                return self.result(
                    "needs_input",
                    questions=questions,
                    data={
                        "known_request": {
                            k: inp[k] for k in ("from_address", "to_address", "move_date", "move_time") if k in inp
                        }
                    },
                )
            self.route = {"pickup": pickup, "destination": destination, "order_time": when}
            return {"route_ready": True, "from_address": pickup["address"], "to_address": destination["address"]}
        if name == "list_service_areas":
            got = await self.tool(self.agent.moving, name, {"country_id": "VN"})
            self.areas = got.get("cities", [])
            return {
                "cities": [
                    {"city_id": r.get("city_id"), "city_name": r.get("name"), "local_name": r.get("local_name")}
                    for r in self.areas
                ],
                "next": "finish with option_ids=[]; catalog needs no addresses",
            }
        if name == "list_moving_services":
            if self.route:
                p = self.route["pickup"]
                arguments = {"lat": p["lat"], "lng": p["lng"], "delivery_type": "TRUCK"}
                if (inp.get("moving_options") or {}).get("service_id"):
                    arguments.pop("delivery_type")
            elif mode == "catalog" and inp.get("city_id"):
                arguments = {"city_id": inp["city_id"]}
            else:
                return {"error": "resolve_route_first_or_supply_city_id"}
            got = await self.tool(self.agent.moving, name, arguments)
            self.catalog = {s["service_id"]: s for s in got.get("services", [])}
            selected_service = (inp.get("moving_options") or {}).get("service_id")
            if mode == "quote" and selected_service:
                # AhaMove's unfiltered catalog may default to INSTANT. A truck
                # chosen by the user must also be checked against the TRUCK
                # catalog, without inferring its type from service-ID prefixes.
                if selected_service not in self.catalog:
                    trucks = await self.tool(self.agent.moving, name, {**arguments, "delivery_type": "TRUCK"})
                    self.catalog.update({s["service_id"]: s for s in trucks.get("services", [])})
                self.catalog = {k: s for k, s in self.catalog.items() if k == selected_service}
            self.catalog_loaded = True
            if mode == "quote" and not self.catalog:
                return self.ask(
                    "service_id",
                    "Gói xe đã chọn không còn trong danh mục tại điểm lấy. Hãy chọn lại từ danh mục hiện tại."
                    if selected_service
                    else "AhaMove hiện không trả dịch vụ chuyển đồ tại điểm lấy này. Bạn muốn kiểm tra điểm lấy khác không?",
                )
            return {
                "services": [
                    {
                        "service_id": s.get("service_id"),
                        "service_name": s.get("name"),
                        "description": s.get("description"),
                        "delivery_type": s.get("delivery_type"),
                    }
                    for s in list(self.catalog.values())[:50]
                ]
            }
        if name == "get_moving_service":
            if args["service_id"] not in self.catalog:
                raise ValueError("Unknown service")
            got = await self.tool(self.agent.moving, name, {"service_id": args["service_id"]})
            self.detail_reads += 1
            return service_details_for_model(got)
        if name == "estimate_move":
            options = validated_options(inp.get("moving_options"))
            ids = [options["service_id"]] if options.get("service_id") else args["service_ids"]
            if (
                mode != "quote"
                or self.route is None
                or not 1 <= len(ids) <= 3
                or len(set(ids)) != len(ids)
                or any(s not in self.catalog for s in ids)
            ):
                raise ValueError("Unobserved service or missing route")
            self.tried_services |= set(ids)
            if self.agent.contact is None:
                return self.failed("invalid_input", "Chưa cấu hình liên hệ báo giá thật của hệ thống.")

            def point(p):
                return {
                    "address": p["address"],
                    "coordinate": {"lat": p["lat"], "lng": p["lng"]},
                    "name": self.agent.contact.name,
                    "mobile": self.agent.contact.mobile,
                }

            draft = {
                "pickup": point(self.route["pickup"]),
                "destinations": [point(self.route["destination"])],
                "payment_method": "CASH",
                "order_time": self.route["order_time"],
            }
            try:
                services = [service_selection(self.catalog[s], options) for s in ids]
            except ValueError as exc:
                self.agent.catalog_cache.clear()
                return self.ask("service_id", str(exc))
            draft = apply_draft_options(draft, options)
            got = await self.tool(self.agent.moving, name, {"draft": draft, "services": services})
            self.quote = got["quote"]
            self.rejection = None
            return {
                "quote_id": self.quote["quote_id"],
                "expires_at": self.quote["expires_at"],
                "options": [
                    {
                        "option_id": f"{self.quote['quote_id']}:{o['service_id']}",
                        "service_id": o["service_id"],
                        "service_name": o.get("service_name"),
                        "fee": o.get("fee"),
                    }
                    for o in self.quote.get("options", [])
                ],
            }
        if name in {"get_move_order", "find_move_orders_by_tracking_number"}:
            if mode != "order_status":
                raise ValueError("Not an order task")
            key = "order_id" if name == "get_move_order" else "tracking_number"
            if not inp.get(key):
                raise ValueError("No order reference")
            got = await self.tool(self.agent.moving, name, {key: inp[key]})
            rows = [got["order"]] if key == "order_id" else got.get("orders", [])
            if len(rows) != 1:
                return self.ask("order_id", "Chưa xác định duy nhất đơn hàng; bạn cung cấp mã đơn AhaMove nhé.")
            self.order = summarize_order(rows[0])
            self.order.pop("supplier", None)  # Driver's personal name is not needed for tool selection.
            return {"order": {k: v for k, v in self.order.items() if k != "shared_link"}}
        if name == "get_move_tracking_link":
            if not self.order:
                raise ValueError("Read order first")
            got = await self.tool(self.agent.moving, name, {"order_id": self.order["order_id"]})
            self.order["shared_link"] = got.get("shared_link")
            return {"tracking_available": bool(self.order["shared_link"])}
        if name == "get_move_order_events":
            if mode != "order_status" or not inp.get("tracking_number"):
                raise ValueError("Need tracking reference")
            await self.tool(self.agent.moving, name, {"tracking_number": inp["tracking_number"]})
            return {"event_history_checked": True}
        if name == "finish":
            if mode == "catalog" and (self.catalog_loaded if inp.get("city_id") else self.areas is not None):
                return self.result(
                    "done",
                    data=public_data(
                        {
                            "cities": [
                                {"city_id": c["city_id"], "city_name": c.get("name"), "local_name": c.get("local_name")}
                                for c in self.areas or []
                            ],
                            "services": [{**s, "service_name": s.get("name")} for s in self.catalog.values()],
                        }
                    ),
                    source_refs=list(self.catalog) or [c["city_id"] for c in self.areas or []],
                )
            if mode == "order_status" and self.order:
                return self.result("done", data={"order": self.order}, source_refs=[self.order["order_id"]])
            if not self.quote or not self.route:
                raise ValueError("Read provider data before finishing")
            options = self.quote.get("options", [])
            keys = {f"{self.quote['quote_id']}:{o['service_id']}": o for o in options}
            ordered = args["option_ids"] or list(keys)
            if len(set(ordered)) != len(ordered) or set(ordered) != set(keys):
                raise ValueError("Finish must retain all observed quote options")
            items, quotes = [], []
            for key in ordered:
                o = keys[key]
                total = (o.get("fee") or {}).get("total_price")
                items.append(
                    {
                        "id": key,
                        "provider": "ahamove",
                        "service_id": o["service_id"],
                        "price_vnd": total,
                        # Estimates may omit the name; use the provider's own catalog entry.
                        "vehicle": o.get("service_name")
                        or (self.catalog.get(o["service_id"]) or {}).get("name")
                        or (self.catalog.get(o["service_id"]) or {}).get("service_name"),
                        "movers": None,
                        "distance_km": (o.get("fee") or {}).get("distance_km"),
                        "duration_seconds": (o.get("fee") or {}).get("duration_seconds"),
                        "fee_breakdown": public_data(o.get("fee")),
                        "date": inp["move_date"],
                    }
                )
                if total is not None:
                    quotes.append(
                        Quote(
                            option_id=key,
                            label=o.get("service_name") or o["service_id"],
                            amount_vnd=int(total),
                            recurrence="one_time",
                        )
                    )
            return self.result(
                "done",
                data={
                    "quotes": items,
                    "quote_id": self.quote["quote_id"],
                    "expires_at": self.quote["expires_at"],
                    "warnings": public_data(self.quote.get("warnings", [])),
                    "route": self.route,
                    "payment_method": "CASH",
                    "moving_options": validated_options(inp.get("moving_options")),
                    "addon_labels": [
                        {"id": r.get("_id") or r.get("request_id"), "label": r.get("name_vi_vn") or r.get("name")}
                        for s in self.catalog.values()
                        for r in s.get("requests", [])
                        if (r.get("_id") or r.get("request_id"))
                        in {x["request_id"] for x in (inp.get("moving_options") or {}).get("requests", [])}
                    ],
                    "from_address": self.route["pickup"]["address"],
                    "to_address": self.route["destination"]["address"],
                },
                quotes=quotes,
                source_refs=[
                    *ordered,
                    *dict.fromkeys(
                        r.get("_id") or r.get("request_id")
                        for s in self.catalog.values()
                        for r in s.get("requests", [])
                        if (r.get("_id") or r.get("request_id"))
                        in {x["request_id"] for x in (inp.get("moving_options") or {}).get("requests", [])}
                    ),
                ],
                missing_fields=[f"quotes[{i}].movers" for i in range(len(items))],
            )
        raise ValueError("Tool not allowed")
