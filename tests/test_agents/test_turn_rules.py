"""Rules for multi-turn Map mode switches, city-scope resolution and planner deferrals (pure functions)."""

import pytest
from relohome_agent.agents.deps import test_deps
from relohome_agent.agents.intake import ScriptedIntake, ground_facts
from relohome_agent.agents.models import AgentName, Plan, RequestKind, SessionContext, Task
from relohome_agent.agents.planner_llm import CapabilityRegistry, LlmPlanner, NeedsInputDraft, PlanDraft, TaskDraft
from relohome_agent.agents.planning import PlannerInput, TemplatePlanner
from relohome_agent.agents.subagents.capabilities import BASELINE_CAPABILITIES, operation_selector_keys
from relohome_agent.agents.subagents.services.location import pick_city_area

from tests.test_agents.helpers import Session, fact, intake_result

SELECTORS = operation_selector_keys(BASELINE_CAPABILITIES.values())


# --- Map: switching operation is not a contradiction ---


def test_selector_keys_come_from_manifest_discriminators():
    assert "map_mode" in SELECTORS
    assert "city" not in SELECTORS and "max_price_vnd" not in SELECTORS


def test_switching_map_operation_replaces_mode_without_conflict():
    old = {"map_mode": fact("nearby", "tìm bệnh viện")}
    new = {"map_mode": fact("route", "tính đường đi bộ")}
    out = ground_facts(new, old, RequestKind.REFINE, ["tìm bệnh viện", "tính đường đi bộ"], [], SELECTORS)
    assert out.facts["map_mode"].value == "route" and not out.conflicts


def test_changing_a_user_constraint_on_refine_still_asks_in_plain_language():
    old = {"max_price_vnd": fact(8_000_000, "dưới 8 triệu")}
    new = {"max_price_vnd": fact(5_000_000, "5 triệu")}
    out = ground_facts(new, old, RequestKind.REFINE, ["dưới 8 triệu", "5 triệu"], [], SELECTORS)
    assert out.facts["max_price_vnd"].value == 8_000_000
    assert out.conflicts and "max_price_vnd" not in out.conflicts[0] and "ngân sách" in out.conflicts[0]


# --- City scope: structure of Location results, not names ---


def area(area_id, name, parent, match, bbox):
    west, south, east, north = bbox
    return {
        "area_id": area_id,
        "name": name,
        "parent": parent,
        "match_type": match,
        "match_score": 0.4,
        "bounding_box": {"west": west, "south": south, "east": east, "north": north},
    }


OUTER = area("a1", "Thành phố A", None, "contains", (105.0, 20.0, 106.0, 21.0))
INNER = area("a2", "Trung tâm A", None, "contains", (105.5, 20.5, 105.9, 20.9))
LOCAL_COPY = area("local", "Thành phố A", None, "contains", (105.0, 20.0, 106.0, 21.0))
FUZZY_CHILD = area("a3", "Xã Á", {"name": "Tỉnh B"}, "fuzzy", (107.0, 15.0, 107.1, 15.1))


def test_city_scope_picks_the_top_level_area_enclosing_the_other_matches():
    assert pick_city_area([INNER, OUTER, LOCAL_COPY, FUZZY_CHILD])["area_id"] == "a1"


def test_city_scope_keeps_an_exact_match():
    exact = {**INNER, "match_type": "exact"}
    assert pick_city_area([exact, OUTER, FUZZY_CHILD])["area_id"] == "a2"


def test_city_scope_still_asks_for_disjoint_top_level_matches():
    other = area("b1", "Thành phố A Mới", None, "contains", (100.0, 10.0, 101.0, 11.0))
    assert pick_city_area([OUTER, other]) is None


# --- Planner deferral: a code-checked question instead of PLAN_INVALID ---

RELOCATION_INTAKE = intake_result(
    RequestKind.REFINE,
    domains=[AgentName.RELOCATION],
    values={"from_address": "Chợ Bến Thành", "to_address": "Quận 1", "move_date": "2026-10-03", "move_time": "15:00"},
)


def planner_input(intake=RELOCATION_INTAKE):
    return PlannerInput(intake=intake, session=SessionContext(), available_agents=[AgentName.RELOCATION])


def draft(*needs, tasks=()):
    return PlanDraft(tasks=list(tasks), actions=[], needs_input=list(needs))


REGISTRY = CapabilityRegistry(BASELINE_CAPABILITIES)


def test_valid_deferral_becomes_a_question_and_satisfies_grounding():
    need = NeedsInputDraft(domain=AgentName.RELOCATION, field="to_address", question="Bạn cho địa chỉ giao cụ thể?")
    questions, errors = LlmPlanner._deferrals(draft(need), Plan(version=0, tasks=[]), planner_input(), REGISTRY)
    assert not errors and questions[0].field == "relocation.to_address"
    deferred = {AgentName.RELOCATION}
    assert LlmPlanner._grounding_errors(Plan(version=0, tasks=[]), planner_input(), deferred) == []
    assert LlmPlanner._grounding_errors(Plan(version=0, tasks=[]), planner_input()) != []


def test_deferral_rejects_unknown_field_unrequested_domain_and_task_overlap():
    unknown = NeedsInputDraft(domain=AgentName.RELOCATION, field="pickup_floor", question="Tầng mấy?")
    other = NeedsInputDraft(domain=AgentName.FLIGHT, field="date", question="Ngày bay?")
    _, errors = LlmPlanner._deferrals(draft(unknown, other), Plan(version=0, tasks=[]), planner_input(), REGISTRY)
    assert len(errors) == 2
    task = Task(id="m", agent=AgentName.RELOCATION, inputs={"mode": "quote"})
    need = NeedsInputDraft(domain=AgentName.RELOCATION, field="to_address", question="Địa chỉ giao?")
    raw = TaskDraft(id="m", agent=AgentName.RELOCATION, inputs_json="{}", depends_on=[], required=True)
    _, errors = LlmPlanner._deferrals(
        draft(need, tasks=[raw]), Plan(version=0, tasks=[task]), planner_input(), REGISTRY
    )
    assert errors and "also has a new task" in errors[0]


# --- Search scope: the latest message defines where to search ---


@pytest.mark.asyncio
async def test_new_district_replaces_old_scope_keeps_budget_and_resolves_its_own_city():
    from relohome_agent.agents.deps import test_deps
    from relohome_agent.agents.intake import ScriptedIntake
    from relohome_agent.agents.planning import TemplatePlanner

    from tests.test_agents.helpers import Session

    first = intake_result(
        RequestKind.NEW_GOAL,
        [AgentName.PROPERTY],
        values={"city": "Hà Nội", "near": "Đại học Bách Khoa", "max_price_vnd": 6_000_000},
        facts={
            "city": fact("Hà Nội", "Hà Nội"),
            "near": fact("Đại học Bách Khoa", "Đại học Bách Khoa"),
            "max_price_vnd": fact(6_000_000, "dưới 6 triệu"),
        },
    )
    second = intake_result(
        RequestKind.REFINE,
        [AgentName.PROPERTY],
        values={"district": "Cầu Giấy"},
        facts={"district": fact("Cầu Giấy", "Cầu Giấy")},
    )
    session = Session(test_deps(ScriptedIntake([first, second]), TemplatePlanner()))
    await session.say("Tìm phòng gần Đại học Bách Khoa, Hà Nội dưới 6 triệu")
    out = await session.say("Mình muốn tìm căn ở Cầu Giấy")
    values = out["intake"].constraints.values
    assert values["district"] == "Cầu Giấy" and "near" not in values
    # The new district resolves its own catalog parent; account preferences may
    # not reintroduce the old city (which could belong to a different province).
    assert "city" not in values and values["max_price_vnd"] == 6_000_000


@pytest.mark.asyncio
async def test_flight_to_the_chosen_home_uses_the_city_recorded_by_the_provider():
    from relohome_agent.agents.common import utcnow
    from relohome_agent.agents.models import ConfirmedFact, Plan, Task, TaskResult, TaskStatus

    home = {"id": "h1", "title": "Căn A", "city": "Đà Nẵng"}
    selected = {"selected:property": ConfirmedFact(value="h1", evidence="chọn", stated_at=utcnow())}
    previous = intake_result(RequestKind.NEW_GOAL, [AgentName.PROPERTY], values={"city": "Đà Nẵng"}, facts=selected)
    turn = intake_result(
        RequestKind.REFINE,
        [AgentName.PROPERTY, AgentName.FLIGHT],
        values={"origin": "Hà Nội", "destination": "selected:property", "flight_date": "2026-10-04"},
    )
    deps = test_deps(ScriptedIntake([turn]), TemplatePlanner())
    session = Session(deps)
    await session.graph.aupdate_state(
        session.config,
        {
            "user_id": session.user_id,
            "thread_id": session.thread_id,
            "intake": previous,
            "plan": Plan(version=1, tasks=[Task(id="home", agent=AgentName.PROPERTY, inputs={"city": "Đà Nẵng"})]),
            "task_status": {"home": TaskStatus.DONE},
            "task_results": {
                "home": TaskResult(
                    task_id="home",
                    agent=AgentName.PROPERTY,
                    plan_version=1,
                    status="done",
                    fetched_at=utcnow(),
                    data={"candidates": [home]},
                )
            },
        },
        as_node="respond",
    )
    out = await session.say("giờ tìm vé từ Hà Nội vào đó ngày 4/10/2026")
    assert out["intake"].constraints.values["destination"] == "Đà Nẵng"
