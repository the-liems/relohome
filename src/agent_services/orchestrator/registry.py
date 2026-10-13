from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import Field, model_validator
from relohome_agent_services.common import Model, ServiceError, fingerprint
from relohome_orchestrator.models import PlanDraft


class ToolSpec(Model):
    service: str
    name: str
    description: str
    contract_version: str
    mode: Literal["read", "write"]
    allowed_intents: list[str] = Field(default_factory=list)
    trusted_arguments: dict[str, Literal["approval_id", "workflow_id", "action_id"]] = Field(default_factory=dict)
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    result_ttl_seconds: int = Field(default=300, ge=1, le=86400)


class Registry(Model):
    version: Literal["1.0.0"] = "1.0.0"
    source: str
    tools: list[ToolSpec]

    @model_validator(mode="after")
    def check_tools(self):
        names = [(t.service, t.name) for t in self.tools]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate registry entry")
        for tool in self.tools:
            for schema in (tool.input_schema, tool.output_schema):
                Draft202012Validator.check_schema(schema)

                # Registry files cannot initiate remote schema retrieval.
                def check_refs(value):
                    if isinstance(value, dict):
                        if "$ref" in value and not value["$ref"].startswith("#"):
                            raise ValueError("Only local JSON schema references are permitted")
                        for child in value.values():
                            check_refs(child)
                    elif isinstance(value, list):
                        for child in value:
                            check_refs(child)

                check_refs(schema)
        return self

    @classmethod
    def load(cls, path: str) -> Registry:
        return cls.model_validate_json(Path(path).read_text(encoding="utf-8"))

    @property
    def digest(self) -> str:
        return fingerprint(self.model_dump(mode="json"))

    def get(self, service: str, name: str) -> ToolSpec:
        for tool in self.tools:
            if (tool.service, tool.name) == (service, name):
                return tool
        raise ServiceError("TOOL_NOT_ALLOWED", "Plan references a tool outside the service registry.", 422)


def arguments(encoded: str) -> dict:
    try:
        value = json.loads(encoded, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, TypeError) as exc:
        raise ServiceError("INVALID_ARGUMENTS", "Task arguments must be a finite JSON object.", 422) from exc


def validate_json(value: Any, schema: dict, code: str = "INVALID_TOOL_INPUT"):
    if next(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(value), None) is not None:
        raise ServiceError(code, "Data does not satisfy the registered tool contract.", 422)


def planning_schema(tool: ToolSpec) -> dict:
    return {
        **tool.input_schema,
        "properties": {
            k: v for k, v in tool.input_schema.get("properties", {}).items() if k not in tool.trusted_arguments
        },
        "required": [k for k in tool.input_schema.get("required", []) if k not in tool.trusted_arguments],
        "additionalProperties": False,
    }


def validate_plan(plan: PlanDraft, registry: Registry, intents: list[str] | None = None) -> PlanDraft:
    ids = {t.task_id for t in plan.tasks}
    if len(ids) != len(plan.tasks):
        raise ServiceError("DUPLICATE_TASK", "Each task needs a unique ID.", 422)
    if not plan.tasks and not (plan.clarification_questions or plan.unsupported_requests):
        raise ServiceError("EMPTY_PLAN", "A plan needs tasks or an explicit reason it cannot proceed.", 422)
    remaining = {}
    for task in plan.tasks:
        tool = registry.get(task.service, task.tool)
        if intents is not None and tool.mode == "write" and not set(tool.allowed_intents).intersection(intents):
            raise ServiceError(
                "WRITE_NOT_REQUESTED", "User intent does not authorize planning this write operation.", 422
            )
        deps = set(task.depends_on)
        if len(deps) != len(task.depends_on) or not deps <= ids or task.task_id in deps:
            raise ServiceError("INVALID_DEPENDENCY", "Task dependency is duplicate, absent or self-referential.", 422)
        values = arguments(task.arguments_json)
        if set(values) & tool.trusted_arguments.keys() or any(
            r.argument in tool.trusted_arguments for r in task.input_refs
        ):
            raise ServiceError("TRUSTED_INPUT_OVERRIDE", "Planner cannot supply backend-owned arguments.", 422)
        schema = planning_schema(tool)
        targets = [r.argument for r in task.input_refs]
        if len(set(targets)) != len(targets) or set(targets) & values.keys():
            raise ServiceError("INVALID_REFERENCE", "Input binding must have exactly one source.", 422)
        for ref in task.input_refs:
            if ref.task_id not in deps or (ref.pointer and not ref.pointer.startswith("/")):
                raise ServiceError(
                    "INVALID_REFERENCE", "Input references must name a direct dependency and JSON pointer.", 422
                )
        if not task.input_refs:
            validate_json(values, schema)
        else:
            # Validate known literal fields now; validate the complete object when bindings resolve.
            properties = schema.get("properties", {})
            for name, value in values.items():
                if name not in properties:
                    raise ServiceError("INVALID_ARGUMENTS", "Unknown input field.", 422)
                field_schema = {**properties[name], "$defs": tool.input_schema.get("$defs", {})}
                validate_json(value, field_schema)
            if not set(targets) <= properties.keys():
                raise ServiceError("INVALID_REFERENCE", "Reference targets an unknown argument.", 422)
            if not set(schema.get("required", [])) <= values.keys() | set(targets):
                raise ServiceError("INVALID_ARGUMENTS", "Required tool input has no literal or reference.", 422)
        remaining[task.task_id] = deps
    resolved: set[str] = set()
    while remaining:
        ready = {key for key, deps in remaining.items() if deps <= resolved}
        if not ready:
            raise ServiceError("CYCLIC_PLAN", "Task dependency graph contains a cycle.", 422)
        resolved.update(ready)
        remaining = {key: deps for key, deps in remaining.items() if key not in ready}
    return plan
