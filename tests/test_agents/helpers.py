"""Tiện ích dựng IntakeResult và chạy graph trong test (không cần mạng)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.types import Command
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.deps import GraphDeps
from relohome_agent.agents.graph import build_graph, default_checkpointer, run_config
from relohome_agent.agents.models import (
    AgentName,
    CommitActionKind,
    ConfirmedFact,
    Constraints,
    IntakeResult,
    Intent,
    RequestKind,
)

ALL_DOMAINS = [AgentName.PROPERTY, AgentName.MAP, AgentName.FLIGHT, AgentName.RELOCATION]


def fact(value: Any, evidence: str, **kw) -> ConfirmedFact:
    return ConfirmedFact(value=value, evidence=evidence, stated_at=utcnow(), **kw)


def intake_result(
    kind: RequestKind = RequestKind.NEW_GOAL,
    domains: list[AgentName] | None = None,
    values: dict | None = None,
    facts: dict | None = None,
    **kw,
) -> IntakeResult:
    return IntakeResult(
        kind=kind,
        normalized_goal="test",
        intent=Intent(name="test", domains=domains or []) if domains is not None else None,
        constraints=Constraints(values=values or {}),
        user_confirmed_facts=facts or {},
        **kw,
    )


def commit_fact(kind: CommitActionKind, evidence: str) -> tuple[str, ConfirmedFact]:
    return f"commit:{kind.value}", fact(True, evidence)


class Session:
    """Chạy nhiều lượt trên cùng một thread."""

    def __init__(self, deps: GraphDeps, thread_id: str = "th1", user_id: str = "u1"):
        self.deps = deps
        self.graph = build_graph(deps, default_checkpointer())
        self.thread_id, self.user_id = thread_id, user_id
        self.turn = 0

    @property
    def config(self) -> dict:
        return run_config(self.thread_id, self.deps)

    async def say(self, text: str) -> dict:
        self.turn += 1
        return await self.graph.ainvoke(
            {
                "messages": [HumanMessage(text)],
                "user_id": self.user_id,
                "thread_id": self.thread_id,
                "request_id": f"r{self.turn}",
            },
            self.config,
        )

    async def resume(self, value: Any) -> dict:
        return await self.graph.ainvoke(Command(resume=value), self.config)

    async def state(self) -> dict:
        return (await self.graph.aget_state(self.config)).values

    async def confirm(self, result: dict, pii: dict[str, dict] | None = None) -> dict:
        """Giả lập backend: lưu form cá nhân, tạo approval gắn payload_hash, rồi resume CONFIRM."""
        payload = result["__interrupt__"][0].value
        pii_refs = {}
        for action_id, data in (pii or {}).items():
            pii_refs[action_id] = await self.deps.pii.put(data)
        expires = min(utcnow() + timedelta(minutes=10), utcnow().fromisoformat(payload["expires_at"]))
        approval = await self.deps.approvals.create(
            user_id=self.user_id,
            thread_id=self.thread_id,
            plan_version=payload["plan_version"],
            payload_hash=payload["payload_hash"],
            expires_at=expires,
            pii_refs=pii_refs,
        )
        return await self.resume(
            {
                "kind": "CONFIRM",
                "plan_version": payload["plan_version"],
                "approval_id": approval.approval_id,
                "pii_refs": pii_refs,
            }
        )
