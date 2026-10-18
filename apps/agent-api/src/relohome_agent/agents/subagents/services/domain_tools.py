"""Invocation-local, grounded read tools for domain agents.

The model chooses operations and observed entities. Arguments which identify a
user constraint are references to task fields, not model-authored coordinates,
filters or credentials. Existing adapters still own normalization and map UI
contracts. Preparation reads are reused by those adapters, not repeated on wire.
"""

from __future__ import annotations

import copy
import json
import re

from jsonschema import Draft202012Validator
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskResult
from relohome_agent.agents.llm_context import decision_data, result_context
from relohome_agent.agents.location_names import city_search_text
from relohome_agent.agents.models import AgentName, Question
from relohome_agent.agents.subagents.services.common import CountingClient
from relohome_agent.agents.subagents.services.location import (
    area_search_args,
    bbox_of_points,
    pick_city_area,
    pick_named_area,
    requested_area_query,
    to_candidate,
    union_bbox,
)
from relohome_agent.agents.subagents.services.moving_llm import function


class MemoizedReadClient(CountingClient):
    """Real provider calls only; cache is private to one invocation."""

    def __init__(self, client, limit):
        super().__init__(client, limit)
        self.cache: dict[str, object] = {}
        self.cached_calls = 0

    async def call(self, tool, arguments):
        key = tool + json.dumps(arguments, sort_keys=True, ensure_ascii=False, default=str)
        if key in self.cache:
            self.cached_calls += 1
            return copy.deepcopy(self.cache[key])
        response = await super().call(tool, arguments)
        self.cache[key] = copy.deepcopy(response)
        return response


class DomainToolSession:
    def __init__(self, req, adapter):
        self.req = req
        self.tools = MemoizedReadClient(adapter.client, req.budget.max_provider_calls)
        # Never mutate the shared adapter/client when tasks execute concurrently.
        self.adapter = copy.copy(adapter)
        self.adapter.client = self.tools
        self.result: AgentTaskResult | None = None
        self.used: set[str] = set()
        self.read_ids: set[str] = set()
        self.anchors: dict[str, dict] = {}
        self.pages: set[str] = set()

    @property
    def rows(self):
        return (self.result.data.get("candidates", self.result.data.get("offers", [])) or []) if self.result else []

    @property
    def ids(self):
        return {r["id"] for r in self.rows}

    def _fields(self, names):
        return [
            k
            for k in names
            if isinstance(self.req.inputs.get(k), str)
            and not self.req.inputs[k].startswith("selected:")
            and not self.req.inputs.get(k + "_place_id")
            and not self.req.inputs.get(k + "_coordinate")
        ]

    def available(self, *, final_call=False):
        req, domain = self.req, self.req.agent
        props = self.adapter.capability.input_schema.get("properties", {})
        fields = [
            k
            for k in props
            if k
            not in {
                "soft_filters",
                "cursor",
                "limit",
                "bounding_box",
                "near_coordinate",
                "near_place_id",
                "selected_listing_id",
                "listing_ids",
                "route_from_place_id",
                "route_to_place_id",
            }
        ]
        available = [
            function(
                "ask_user",
                "Ask one necessary question or propose a change; NEVER apply it without consent.",
                {
                    "field": {"type": "string", "enum": fields},
                    "question": {"type": "string", "minLength": 1, "maxLength": 350},
                },
            )
        ]
        if self.result is not None:
            if self.result.status == "done" and self.req.attempt == 1:
                available.append(
                    function(
                        "request_replan",
                        "Report a missing dependency or inconsistent results to Orchestrator. Not for relaxing user filters or repeating identical searches.",
                        {
                            "reason": {"type": "string", "minLength": 1, "maxLength": 400},
                            "suggested_next_step": {"type": "string", "minLength": 1, "maxLength": 300},
                        },
                    )
                )
            available.append(
                function(
                    "finish",
                    "Return grounded results and a short assessment to Orchestrator; never claim a booking.",
                    {
                        "option_ids": {
                            "type": "array",
                            "items": {"type": "string", **({"enum": sorted(self.ids)} if self.ids else {})},
                            "maxItems": len(self.ids),
                        },
                        "satisfaction": {"enum": ["fulfilled", "limited"]},
                        "reason": {"type": "string", "maxLength": 400},
                        "next_step": {"type": "string", "maxLength": 300},
                    },
                )
            )
        if final_call or self.tools.calls >= self.tools.limit or (self.result and self.result.status != "done"):
            return available

        if self.result is None:
            if domain in {AgentName.PROPERTY, AgentName.MAP}:
                # Actual field references let the model decide what to resolve first,
                # but prevent it from substituting a different user's location.
                for name, fields in [
                    ("resolve_location", self._fields(("near", "route_from", "route_to"))),
                    ("search_areas", self._fields(("city", "district"))),
                ]:
                    fields = [f for f in fields if name + ":" + f not in self.used]
                    if fields:
                        available.append(
                            function(
                                name,
                                "Resolve the named task field using real Location data; ambiguous/fuzzy matches need user selection.",
                                {"field": {"type": "string", "enum": fields}},
                            )
                        )
            elif domain == AgentName.FLIGHT:
                fields = [f for f in self._fields(("origin", "destination")) if "search_airports:" + f not in self.used]
                if fields:
                    available.append(
                        function(
                            "search_airports",
                            "Inspect airports for the task endpoint before searching flights.",
                            {"field": {"type": "string", "enum": fields}},
                        )
                    )

            if domain == AgentName.PROPERTY:
                available.append(
                    function(
                        "compare_housing" if req.inputs.get("housing_mode") == "compare" else "search_housing",
                        "Read the confirmed 2–4 listing IDs, preserving their order; return factual comparison and unknown costs, never select a home."
                        if req.inputs.get("housing_mode") == "compare"
                        else "Search with unchanged hard filters; resolves unprepared scope safely. limit is the requested result count, null uses task/default. Reads bounded pages mechanically; ambiguity stops for user selection. PostGIS filters, not the LLM.",
                        {
                            "limit": {
                                "type": ["integer", "null"],
                                "minimum": 1,
                                "maximum": int(req.inputs.get("limit") or 20),
                            }
                        },
                    )
                )
            elif domain == AgentName.FLIGHT:
                available.append(
                    function(
                        "search_flights",
                        "Search real offers for the unchanged route, date and passengers; resolves unprepared airports.",
                    )
                )
            elif domain == AgentName.MAP:
                # Both operations belong to the domain, but only the requested mode is
                # executable; the model may first resolve endpoints or ask for input.
                if req.inputs.get("map_mode") == "route":
                    available.append(
                        function(
                            "calculate_route_between_entities",
                            "Compute the requested route using OSRM and grounded endpoint IDs.",
                        )
                    )
                else:
                    available.append(
                        function(
                            "find_nearby_places",
                            "Find requested amenities around the named place, selected home or upstream homes.",
                        )
                    )
            else:
                available.append(
                    function(
                        "get_payment",
                        "Read only the backend-owned payment in the task. Provider status is authoritative.",
                    )
                )
            # The model, not a keyword classifier, chooses whether a facts-only
            # retrieval is sufficient. Keep the inspect -> assess path available.
            if domain in {AgentName.PROPERTY, AgentName.FLIGHT} and req.inputs.get("housing_mode") != "compare":
                search = next(t for t in available if t["name"] in {"search_housing", "search_flights"})
                combined = copy.deepcopy(search)
                combined["name"] += "_and_return"
                combined["description"] = (
                    "Search and return provider facts immediately, without a second LLM assessment. "
                    "Use for a straightforward list with the confirmed filters. Resolves endpoints safely; "
                    "ambiguity still asks the user. NOT for comparing, ranking by preferences, verifying custom "
                    "requirements, or planning further reads. Those need the normal search then inspect/finish. "
                    + search["description"]
                )
                available.append(combined)
        elif domain in {AgentName.PROPERTY, AgentName.FLIGHT}:
            ids = self.ids - self.read_ids
            if ids:
                available.append(
                    function(
                        "get_housing" if domain == AgentName.PROPERTY else "get_offer",
                        "Read details only if needed to assess an observed option; do not infer missing facts.",
                        {"id": {"type": "string", "enum": sorted(ids)}},
                    )
                )
            cursor = self.result.data.get("next_cursor")
            if domain == AgentName.PROPERTY and cursor and cursor not in self.pages:
                available.append(
                    function(
                        "search_housing",
                        "Read the next observed page with identical filters; merge real candidates, never relax a hard requirement.",
                        {"cursor": {"type": "string", "enum": [cursor]}},
                    )
                )
        return available

    async def execute(self, name, args):
        req, domain = self.req, self.req.agent
        schema = next((t["parameters"] for t in self.available() if t["name"] == name), None)
        if schema is None or not Draft202012Validator(schema).is_valid(args):
            raise ValueError("Operation is not available or arguments are ungrounded")
        return_facts = name in {"search_housing_and_return", "search_flights_and_return"}
        if return_facts:
            name = name.removesuffix("_and_return")
        if name == "ask_user":
            if self.result is None:
                self.result = AgentTaskResult(
                    task_id=req.task_id,
                    plan_version=req.plan_version,
                    status="needs_input",
                    source="lifeflow-" + domain.value,
                    source_kind="sandbox" if domain == AgentName.PAYMENT else "live",
                    fetched_at=utcnow(),
                    questions=[Question(field=args["field"], text=args["question"])],
                )
            else:
                # Preserve provider-generated choices if the question was already grounded.
                if not self.result.questions:
                    self.result.questions = [Question(field=args["field"], text=args["question"])]
                self.result.status = "needs_input"
            return {"status": "needs_input"}, True
        if name == "finish":
            self.rank(args["option_ids"])
            satisfaction = args["satisfaction"]
            if not self.rows and domain in {AgentName.PROPERTY, AgentName.FLIGHT}:
                satisfaction = "limited"
            if self.result.data.get("pagination_issue"):
                satisfaction = "limited"
            self.result.data["agent_assessment"] = {
                "satisfaction": satisfaction,
                "reason": args["reason"],
                "next_step": args["next_step"],
                "source_refs": list(self.result.source_refs),
                "kind": "model_assessment_not_provider_fact",
            }
            return {"status": self.result.status}, True
        if name == "request_replan":
            self.result.data["agent_replan"] = {
                "reason": args["reason"],
                "suggested_next_step": args["suggested_next_step"],
                "source_refs": list(self.result.source_refs),
            }
            self.result.data["agent_assessment"] = {
                "satisfaction": "limited",
                "kind": "model_assessment_not_provider_fact",
                "reason": args["reason"],
                "next_step": args["suggested_next_step"],
                "source_refs": list(self.result.source_refs),
            }
            return {"status": "replan_requested"}, True
        if name in {"resolve_location", "search_areas", "search_airports"}:
            return await self.prepare(name, args["field"]), self.result is not None
        if name in {"get_housing", "get_offer"}:
            return await self.detail(name, args["id"]), False
        cursor = args.get("cursor")
        requested_limit = args.get("limit")
        inputs = {
            **req.inputs,
            **({"cursor": cursor} if cursor else {}),
            **({"limit": requested_limit} if requested_limit is not None else {}),
        }
        if domain == AgentName.PROPERTY and self.anchors.get("near") and not inputs.get("bounding_box"):
            # Only a uniquely grounded, non-fuzzy provider location is bound here.
            inputs["near_coordinate"] = self.anchors["near"]["location"]
        if domain == AgentName.MAP:
            for field in ("near", "route_from", "route_to"):
                anchor = self.anchors.get(field)
                if anchor and anchor.get("entity_type") == "place" and anchor.get("canonical_id"):
                    inputs.setdefault(field + "_place_id", anchor["canonical_id"])
        result = await self.adapter.run(req.model_copy(update={"inputs": inputs}))
        if cursor:
            self.pages.add(cursor)
            if result.status == "done":
                self.merge_page(result)
            else:
                # A failed second page must not discard an already valid first page.
                self.result.data["pagination_issue"] = {
                    "status": result.status,
                    "code": result.error.code if result.error else "needs_input",
                }
        else:
            self.result = result
        if domain == AgentName.PROPERTY and inputs.get("housing_mode") == "compare" and result.status == "done":
            self.read_ids.update(self.ids)  # compare_housing has already re-read these details.
        if domain == AgentName.PROPERTY and not cursor and requested_limit is not None and self.result.status == "done":
            # A model-selected target count, not keyword parsing of user language.
            # No extra semantic decision between pages with identical hard filters.
            for _ in range(2):
                next_cursor = self.result.data.get("next_cursor")
                if len(self.rows) >= requested_limit or not next_cursor:
                    break
                if next_cursor in self.pages or self.tools.calls >= self.tools.limit:
                    self.result.data["pagination_issue"] = {"status": "limited", "code": "pagination_budget_or_cycle"}
                    break
                self.pages.add(next_cursor)
                page_inputs = {**inputs, "cursor": next_cursor, "limit": requested_limit - len(self.rows)}
                page = await self.adapter.run(req.model_copy(update={"inputs": page_inputs}))
                if page.status != "done":
                    self.result.data["pagination_issue"] = {
                        "status": page.status,
                        "code": page.error.code if page.error else "needs_input",
                    }
                    break
                self.merge_page(page)
            if len(self.rows) < requested_limit and self.result.data.get("next_cursor"):
                self.result.data.setdefault("pagination_issue", {"status": "limited", "code": "pagination_page_cap"})
        if return_facts and self.result.status == "done":
            # Do not manufacture model assessment, reorder options or upgrade
            # missing evidence simply because retrieval has finished.
            self.result.data["agent_completion"] = {
                "mode": "provider_facts",
                "model_assessed": False,
                "scope": "confirmed_search_filters_only",
            }
        return result_context(self.result), return_facts or self.result.status != "done"

    async def prepare(self, name, field):
        text = self.req.inputs[field]
        if field == "city":
            text = city_search_text(text)
        self.used.add(name + ":" + field)
        if name == "search_airports":
            rows = await self.tools.call(name, {"query": text, "limit": 5})
            codes = {r.get("code") for r in rows or [] if r.get("code")}
            if len(codes) != 1 and text not in codes:
                self.result = AgentTaskResult(
                    task_id=self.req.task_id,
                    plan_version=self.req.plan_version,
                    status="needs_input",
                    source="lifeflow-flights",
                    source_kind="live",
                    fetched_at=utcnow(),
                    questions=[
                        Question(field=field, text=f'Bạn muốn dùng sân bay nào cho "{text}"?', options=sorted(codes))
                    ],
                )
            return decision_data({"airports": rows})
        bbox = None
        if "city" in self.anchors:
            bbox = self.anchors["city"].get("bounding_box")
        elif self.req.inputs.get("city") and field != "city":
            areas = (
                (await self.tools.call("search_areas", {"text": city_search_text(self.req.inputs["city"]), "limit": 5}))
                or {}
            ).get("results") or []
            city = pick_city_area(areas)
            if city is None:
                self.result = self.adapter._choose(self.req, self.tools, "city", self.req.inputs["city"], areas)
                return {
                    "status": "needs_input",
                    "questions": [q.model_dump(mode="json") for q in self.result.questions],
                }
            self.anchors["city"] = city
            bbox = city.get("bounding_box")
        if self.req.agent == AgentName.PROPERTY and name == "resolve_location" and field == "near":
            matching = await self.adapter._areas_for_near(self.req, self.tools, self.anchors.get("city"))
            if len(matching) > 1:
                self.result = self.adapter._choose(
                    self.req, self.tools, "district", requested_area_query(self.req) or text, matching
                )
                return {
                    "status": "needs_input",
                    "questions": [q.model_dump(mode="json") for q in self.result.questions],
                }
            if matching:
                # An administrative polygon is NOT a point anchor. The adapter
                # consumes this same memoized lookup when search_housing runs.
                return decision_data({"field": field, "resolved_area": matching[0], "next": "search_housing"})
        if name == "search_areas":
            arguments = {"text": text, "limit": 5}
            if field == "district":
                arguments = area_search_args(text, city_scope=self.anchors.get("city"), bounding_box=bbox)
            options = ((await self.tools.call(name, arguments)) or {}).get("results") or []
            found = pick_city_area(options) if field == "city" else pick_named_area(options, text, bbox)
        else:
            found, options = await self.adapter._resolve(self.tools, text, bbox)
        if found is None:
            self.result = self.adapter._choose(self.req, self.tools, field, text, options)
            return {"status": "needs_input", "questions": [q.model_dump(mode="json") for q in self.result.questions]}
        self.anchors[field] = found
        return decision_data({"field": field, "resolved": found})

    async def detail(self, name, identifier):
        raw = await self.tools.call(name, {"listing_id" if name == "get_housing" else "offer_id": identifier})
        if name == "get_housing":
            if raw.get("listing_id") != identifier:
                raise ValueError("Mismatched housing ID")
            output, _ = to_candidate(raw, self.req.inputs.get("must_have", []))
        else:
            offer = raw.get("offer") or {}
            if offer.get("offer_id") != identifier or offer.get("source") != "serpapi":
                raise ValueError("Unverified flight offer source")
            output = {
                k: offer.get(k) for k in ("offer_id", "total_price", "currency", "expires_at", "segments", "source")
            }
            output["fare_rules_status"] = "not_verified_by_live_provider"
        self.read_ids.add(identifier)
        self.result.data.setdefault("details", {})[identifier] = output
        return decision_data(output)

    def merge_page(self, page):
        result = self.result
        old_count = len(self.rows)
        known = self.ids
        indexes = {}
        for i, row in enumerate(page.data["candidates"]):
            if row["id"] not in known:
                indexes[i] = len(result.data["candidates"])
                result.data["candidates"].append(row)
                known.add(row["id"])
        result.quotes += [q for q in page.quotes if q.option_id not in {q.option_id for q in result.quotes}]
        for field in page.missing_fields:
            match = re.match(r"candidates\[(\d+)\]", field)
            if match and int(match.group(1)) in indexes:
                result.missing_fields.append(
                    re.sub(r"^candidates\[\d+\]", f"candidates[{indexes[int(match.group(1))]}]", field)
                )
        result.source_refs = list(dict.fromkeys([*result.source_refs, *page.source_refs]))
        for key in ("has_more", "next_cursor"):
            result.data[key] = page.data.get(key)
        context = result.data["map_context"]
        context["listing_ids"] = [c["id"] for c in self.rows]
        context["viewport"] = (
            union_bbox(context["viewport"], bbox_of_points(self.rows))
            if context.get("viewport")
            else bbox_of_points(self.rows)
        )
        result.data.setdefault("pages_read", []).append(
            {"query_id": page.data.get("query_id"), "added": len(self.rows) - old_count}
        )
        result.fetched_at = page.fetched_at

    def rank(self, order):
        if not order:
            return
        if not set(order) <= self.ids or len(order) != len(set(order)):
            raise ValueError("Cannot invent or repeat options")
        order = [*order, *(r["id"] for r in self.rows if r["id"] not in order)]
        key = "candidates" if self.req.agent == AgentName.PROPERTY else "offers"
        old_ids = [r["id"] for r in self.rows]
        self.result.missing_fields = [
            re.sub(
                rf"^{key}\[(\d+)\]",
                lambda m: f"{key}[{order.index(old_ids[int(m.group(1))])}]",
                field,
            )
            for field in self.result.missing_fields
        ]
        self.result.data[key] = sorted(self.rows, key=lambda r: order.index(r["id"]))
        self.result.quotes.sort(key=lambda q: order.index(q.option_id))
