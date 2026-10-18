import pytest
from relohome_agent.agents.common import utcnow
from relohome_agent.agents.intake import FixedIntake
from relohome_agent.agents.llm_context import result_context
from relohome_agent.agents.models import AgentName, TaskResult
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings
from relohome_gateway.server import presentation
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.services.profiles import ProfileService
from relohome_roommate.services.safety import SafetyService

from tests.test_agents.helpers import Session, fact, intake_result
from tests.test_roommate.test_discovery_api import make_app
from tests.test_roommate.test_profile_lifecycle import complete


@pytest.mark.asyncio
async def test_checkpoint_keeps_handles_and_fresh_read_hides_blocked_profile(tmp_path):
    _, runtime = make_app(tmp_path)
    with runtime.context() as ctx:
        for name in ("viewer", "candidate"):
            AccessService(ctx).accept(Actor(id=name), True, "roommate-1.0")
        draft = ProfileService(ctx).save(Actor(id="candidate"), complete(), None)
        ProfileService(ctx).transition(Actor(id="candidate"), "publish", draft.version, True)
    criteria = {"city": "hcm"}
    intake = intake_result(
        domains=[AgentName.ROOMMATE],
        values={"roommate_criteria": criteria},
        facts={"roommate_criteria": fact(criteria, "HCM")},
    )
    service = AgentService.create(
        intake=FixedIntake(intake),
        roommate_runtime=runtime,
        services=Settings(_env_file=None, agent_subagents="fake"),
    )
    session = Session(service.deps, user_id="viewer")
    out = await session.say("Tìm người ở cùng HCM")
    assert out["response"].kind == "ANSWER"
    assert out["task_results"]["t1"].data["profile_refs"] == [{"profile_id": "candidate"}]
    serialized = str((await session.state())["task_results"])
    assert complete().introduction not in serialized and "avatar_id" not in serialized
    with runtime.context() as ctx:
        assert DiscoveryService(ctx).detail(Actor(id="viewer"), "candidate")["available"]
        SafetyService(ctx).block(Actor(id="viewer"), "candidate", True, "block-operation-001")
        assert DiscoveryService(ctx).detail(Actor(id="viewer"), "candidate")["available"] is False


def test_roommate_projection_drops_snapshots_and_keeps_other_domains():
    data = {
        "entry": "roommate",
        "availability": "ready",
        "profile_refs": [{"profile_id": "p1", "name": "secret"}],
        "contact": "private-channel",
        "intro": "private-intro",
        "photos": ["private-image"],
        "profile": {"name": "secret"},
    }
    result = TaskResult(
        task_id="r1",
        agent=AgentName.ROOMMATE,
        plan_version=1,
        status="done",
        data=data,
        source="roommate-store",
        source_kind="live",
        source_refs=["p1"],
        fetched_at=utcnow(),
        summary="private-summary",
    )
    context = result_context(result)
    assert context["data"]["profile_refs"] == [{"profile_id": "p1"}]
    assert "private-" not in str(context) and "secret" not in str(context)
    payload = {
        "response": {
            "data": {
                "results": {
                    "r1": {"agent": "roommate", "data": data, "summary": "private-summary"},
                    "h1": {"agent": "property", "data": {"candidates": [{"id": "h1", "title": "Keep housing"}]}},
                }
            }
        }
    }
    output = presentation(payload, {})
    assert "private-" not in str(output) and "secret" not in str(output)
    assert output["response"]["data"]["results"]["h1"]["data"]["candidates"][0]["title"] == "Keep housing"
