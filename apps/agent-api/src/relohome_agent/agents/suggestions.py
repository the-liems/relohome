"""Gợi ý bước tiếp theo (agent-graph.md §6.10, S9). Hàm thuần: không gọi subagent hay API nào."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from relohome_agent.agents.intake import selected_fact_key
from relohome_agent.agents.models import AgentName, CommitActionKind, Suggestion, TaskStatus

if TYPE_CHECKING:
    from relohome_agent.agents.deps import AgentRegistry


@dataclass
class _Ctx:
    done: set[AgentName]
    in_plan: set[AgentName]
    committed_kinds: set[CommitActionKind]
    booked_this_turn: set[CommitActionKind]
    planned_commits: set[CommitActionKind]
    registry: AgentRegistry
    origin_hint: str | None
    property_city: str | None
    flight_destination: str | None
    selected_property: bool


@dataclass(frozen=True)
class NextStep:
    key: str
    domain: AgentName
    kind: Literal["search", "quote", "book"]
    label: str
    message: Callable[[_Ctx], str]
    when: Callable[[_Ctx], bool]


def _supports(ctx: _Ctx, domain: AgentName, kind: CommitActionKind) -> bool:
    return kind in ctx.registry.commit_kinds(domain)


NEXT_STEPS: tuple[NextStep, ...] = (
    NextStep(
        "quote:relocation",
        AgentName.RELOCATION,
        "quote",
        "Báo giá chuyển đồ",
        lambda c: "Báo giá chuyển đồ tới phòng mình chọn giúp mình",
        # Moving and flights follow a chosen home, not a list of search results.
        lambda c: (
            c.selected_property
            and AgentName.RELOCATION not in c.in_plan
            and c.registry.get(AgentName.RELOCATION) is not None
        ),
    ),
    NextStep(
        "search:flight",
        AgentName.FLIGHT,
        "search",
        "Tìm vé máy bay",
        lambda c: f"Tìm vé máy bay từ {c.origin_hint} tới {c.property_city or 'đó'}",
        lambda c: (
            c.selected_property
            and AgentName.FLIGHT not in c.in_plan
            and bool(c.origin_hint)
            and (c.property_city is None or c.origin_hint.lower() not in c.property_city.lower())
        ),
    ),
    NextStep(
        "book:flight",
        AgentName.FLIGHT,
        "book",
        "Đặt chuyến này",
        lambda c: "Đặt giúp mình chuyến bay này",
        lambda c: (
            AgentName.FLIGHT in c.done
            and CommitActionKind.FLIGHT_BOOKING not in c.committed_kinds
            and CommitActionKind.FLIGHT_BOOKING not in c.planned_commits
            and _supports(c, AgentName.FLIGHT, CommitActionKind.FLIGHT_BOOKING)
        ),
    ),
    NextStep(
        "search:property",
        AgentName.PROPERTY,
        "search",
        "Tìm chỗ ở",
        lambda c: f"Tìm chỗ ở tại {c.flight_destination or 'nơi mình đến'}",
        lambda c: AgentName.FLIGHT in c.done and AgentName.PROPERTY not in c.in_plan,
    ),
    NextStep(
        "book:relocation",
        AgentName.RELOCATION,
        "book",
        "Đặt xe với báo giá này",
        lambda c: "Đặt xe chuyển đồ với báo giá này giúp mình",
        lambda c: (
            AgentName.RELOCATION in c.done
            and CommitActionKind.MOVING_BOOKING not in c.committed_kinds
            and CommitActionKind.MOVING_BOOKING not in c.planned_commits
            and _supports(c, AgentName.RELOCATION, CommitActionKind.MOVING_BOOKING)
        ),
    ),
)


def next_step_suggestions(
    state: dict, registry: AgentRegistry, max_suggestions: int, response_kind: str
) -> list[Suggestion]:
    if response_kind in ("UNSUPPORTED", "CANCELLED", "ERROR"):
        return []
    plan = state.get("plan")
    statuses = state.get("task_status") or {}
    results = state.get("task_results") or {}
    if response_kind == "CLARIFY" and not any(
        statuses.get(t.id) == TaskStatus.DONE for t in (plan.tasks if plan else [])
    ):
        return []  # CLARIFY do intake chặn: chưa có kết quả
    limit = 1 if response_kind == "CLARIFY" else max_suggestions
    tasks = plan.tasks if plan else []
    done = {t.agent for t in tasks if statuses.get(t.id) == TaskStatus.DONE}
    committed = state.get("committed") or {}
    transaction = state.get("transaction")
    intake = state.get("intake")
    session = state.get("session")
    origin = session.hints.get("origin") if session else None
    property_city = flight_destination = None
    for task in tasks:
        result = results.get(task.id)
        if task.agent == AgentName.PROPERTY:
            property_city = task.inputs.get("city") or (result.data.get("area_name") if result else None)
        if task.agent == AgentName.FLIGHT:
            flight_destination = task.inputs.get("destination")
    ctx = _Ctx(
        done=done,
        # Lĩnh vực đã có trong plan hoặc người dùng đã yêu cầu (đang chờ thông tin) thì không gợi ý lại.
        in_plan={t.agent for t in tasks} | set(intake.domains if intake else []),
        committed_kinds={r.kind for r in committed.values()},
        booked_this_turn={r.kind for r in transaction.receipts} if transaction else set(),
        planned_commits={a.kind for a in plan.commit_actions} if plan else set(),
        registry=registry,
        origin_hint=str(origin.value) if origin and not origin.stop_prefill else None,
        property_city=property_city,
        flight_destination=flight_destination,
        selected_property=bool(intake and selected_fact_key(AgentName.PROPERTY) in intake.user_confirmed_facts),
    )
    declined = set(state.get("declined_suggestions") or [])
    out: list[Suggestion] = []
    for step in NEXT_STEPS:
        if len(out) >= limit:
            break
        if step.key in declined or any(s.domain == step.domain and s.kind == step.kind for s in out):
            continue
        if step.kind == "book" and step.domain not in done:
            continue
        if step.when(ctx):
            out.append(
                Suggestion(
                    key=step.key, label=step.label, message=step.message(ctx), domain=step.domain, kind=step.kind
                )
            )
    return out
