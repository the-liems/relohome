"""`FakeAgent`: subagent giả lập đọc fixture JSON theo lĩnh vực (agent-graph.md §6.3.5).

Dùng cho giai đoạn khung và test. Kết quả luôn có `source_kind = "fake"` để `respond` ghi chú rõ.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from relohome_agent.agents.common import utcnow
from relohome_agent.agents.contracts import AgentCapability, AgentTaskRequest, AgentTaskResult, reject_unsupported
from relohome_agent.agents.models import AgentName, AgentUsage
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

Responder = Callable[[AgentTaskRequest], AgentTaskResult | dict[str, Any]]


def load_fixture(agent: AgentName) -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / f"{agent.value}.json").read_text(encoding="utf-8"))


class FakeAgent:
    """Trả `AgentTaskResult` hợp lệ từ fixture.

    - `fixture`: dict `{data, quotes, source_refs, missing_fields}`; mặc định đọc từ `fixtures/<agent>.json`.
    - `responder`: hàm tuỳ biến theo request (test lỗi, needs_input…); ưu tiên hơn fixture.
    """

    def __init__(
        self,
        agent: AgentName,
        *,
        fixture: dict[str, Any] | None = None,
        responder: Responder | None = None,
        capability: AgentCapability | None = None,
        clock: Callable[[], datetime] = utcnow,
    ):
        self.capability = capability or BASELINE_CAPABILITIES[agent]
        self.fixture = fixture if fixture is not None else load_fixture(agent)
        self.responder = responder
        self.clock = clock
        self.requests: list[AgentTaskRequest] = []

    async def run(self, req: AgentTaskRequest) -> AgentTaskResult:
        self.requests.append(req)
        if (rejected := reject_unsupported(req, f"fake-{req.agent.value}", "fake")) is not None:
            return rejected
        if self.responder is not None:
            out = self.responder(req)
            return (
                out
                if isinstance(out, AgentTaskResult)
                else AgentTaskResult.model_validate(
                    {
                        "task_id": req.task_id,
                        "plan_version": req.plan_version,
                        "source": "fake",
                        "source_kind": "fake",
                        "fetched_at": self.clock(),
                        **out,
                    }
                )
            )
        fx = self.fixture
        return AgentTaskResult(
            task_id=req.task_id,
            plan_version=req.plan_version,
            status="done",
            data=fx.get("data", {}),
            quotes=fx.get("quotes", []),
            missing_fields=fx.get("missing_fields", []),
            source=f"fake-{req.agent.value}",
            source_kind="fake",
            source_refs=fx.get("source_refs", []),
            fetched_at=self.clock(),
            summary=fx.get("summary"),
            usage=AgentUsage(provider_calls=1),
        )
