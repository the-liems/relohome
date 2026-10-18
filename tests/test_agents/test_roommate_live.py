"""Opt-in real Intake/Planner + real private Roommate store; no per-person LLM calls."""

import os
import secrets
from uuid import uuid4

import httpx
import pytest
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_roommate.models import RoommateProfile
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.profiles import ProfileService

from tests import live

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("RUN_LIVE_ROOMMATE") != "1", reason="Explicit live Roommate LLM opt-in"),
]


async def test_real_roommate_intake_planner_reads_refs_without_candidate_llm(tmp_path):
    token = secrets.token_urlsafe(32)
    runtime = RoommateRuntime.open(
        Settings(
            _env_file=None,
            roommate_enabled=True,
            roommate_state_dir=tmp_path / "private",
            roommate_moderators="synthetic-reviewer",
            agent_api_token=token,
        )
    )
    viewer, candidate = "viewer_" + uuid4().hex, "candidate_" + uuid4().hex
    with runtime.context() as ctx:
        for name in (viewer, candidate):
            AccessService(ctx).accept(Actor(id=name), True, "roommate-1.0")
        profile = RoommateProfile(
            display_name="Synthetic roommate candidate",
            introduction="A synthetic profile for a private runtime audit.",
            facts={
                "city": "hanoi",
                "area_ids": ["city:hanoi"],
                "budget": {"min_vnd": 2000000, "max_vnd": 3000000, "fee_basis": "rent_only"},
                "need": {"kind": "looking_together"},
                "move_in": {"kind": "flexible"},
            },
        )
        draft = ProfileService(ctx).save(Actor(id=candidate), profile, None)
        ProfileService(ctx).transition(Actor(id=candidate), "publish", draft.version, True)
    service = await AgentService.open(
        Settings(
            _env_file=None,
            agent_state_dir=str(tmp_path / "graph"),
            agent_api_token=token,
            openai_api_key=live.env_test("OPENAI_API_KEY"),
        ),
        roommate_runtime=runtime,
    )
    from relohome_agent.main import app

    previous_service = getattr(app.state, "agent_service", None)
    previous_runtime = getattr(app.state, "roommate_runtime", None)
    app.state.agent_service, app.state.roommate_runtime = service, runtime
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://audit", timeout=120
        ) as client:
            response = await client.post(
                "/api/v1/chat",
                headers={"Authorization": "Bearer " + token, "X-User-Id": viewer},
                json={
                    "message": "Tôi muốn tìm những người đang có nhu cầu ở cùng tại Hà Nội. Ngân sách tiền thuê tối đa 3 triệu đồng một người mỗi tháng, chưa gồm phí. Chỉ tìm hồ sơ người, chưa tìm nhà."
                },
            )
            assert response.status_code == 200
            results = response.json().get("response", {}).get("data", {}).get("results", {})
            assert {item["agent"] for item in results.values()} == {"roommate"}
            item = next(iter(results.values()))
            assert item["data"]["availability"] == "ready"
            assert item["data"]["profile_refs"] == [{"profile_id": candidate}]
            assert item["usage"]["llm_calls"] == item["usage"]["provider_calls"] == 0
            assert profile.display_name not in response.text
    finally:
        app.state.agent_service, app.state.roommate_runtime = previous_service, previous_runtime
        await service.close()
        runtime.close()
