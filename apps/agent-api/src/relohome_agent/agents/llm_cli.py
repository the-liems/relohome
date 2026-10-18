"""Standalone JSON/stdio harness for real components; does not compile or wire a graph."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from langchain_core.messages import HumanMessage
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentTaskRequest
from relohome_agent.agents.intake import IntakeInput, resolve_missing
from relohome_agent.agents.llm import LLMError
from relohome_agent.agents.llm_components import build_llm_components
from relohome_agent.agents.models import AgentName, CommitActionKind, SessionContext
from relohome_agent.agents.planning import PlannerInput
from relohome_agent.config import Settings
from relohome_agent.services.adapters.registry import ServiceRegistry


async def run(component: str, data: dict) -> dict:
    settings = Settings()
    registry = ServiceRegistry.from_settings(settings)
    agents = build_llm_components(settings, registry)
    try:
        if component == "intake":
            message = data.get("message")
            if not isinstance(message, str) or not message.strip():
                raise ValueError("message must be a non-empty string")
            raw = await agents.intake.understand(
                IntakeInput(
                    messages=[HumanMessage(message)], session=SessionContext(), supported_domains=list(AgentName)
                )
            )
            raw.commit_requested = [
                kind for kind in CommitActionKind if f"commit:{kind.value}" in raw.user_confirmed_facts
            ]
            result = resolve_missing(
                raw, session=SessionContext(), plan=None, cost_tiers={}, prefill_ttl={}, now=utcnow()
            )
            return {"result": result.model_dump(mode="json"), "usage": agents.intake.usage.model_dump()}
        if component == "planner":
            result = await agents.planner.plan(PlannerInput.model_validate(data))
            return {"result": result.model_dump(mode="json"), "usage": agents.planner.usage.model_dump()}
        if agents.moving is None:
            raise LLMError("MOVING_NOT_CONFIGURED", "Configure MOVING_MCP_URL and read-only token.")
        return (await agents.moving.run_task(AgentTaskRequest.model_validate(data))).model_dump(mode="json")
    finally:
        await agents.close()
        await registry.aclose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=("intake", "planner", "moving"))
    args = parser.parse_args()
    try:
        body = sys.stdin.read(65537)
        if len(body) > 65536:
            raise ValueError("Input too large")
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError("JSON object required")
        result = asyncio.run(run(args.component, data))
    except LLMError as exc:
        print(json.dumps({"error": exc.code, "message": exc.message}, ensure_ascii=False))
        return 1
    except (ValueError, TypeError):
        print(json.dumps({"error": "INVALID_INPUT", "message": "Input does not match component contract."}))
        return 1
    except TimeoutError:
        print(json.dumps({"error": "TIMEOUT"}))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
