import httpx
import pytest
from relohome_agent.agents.models import AgentName
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
async def test_application_lifespan_wires_roommate_and_private_validation(tmp_path, monkeypatch, enabled):
    import relohome_agent.main as main

    settings = Settings(
        _env_file=None,
        app_env="test",
        roommate_enabled=enabled,
        roommate_state_dir=tmp_path / "private",
        roommate_moderators="mod",
        agent_api_token="test-token",
    )
    monkeypatch.setattr(main, "get_settings", lambda: settings)

    async def isolated_agent_open(*, roommate_runtime):
        # Exercise app composition with an actual graph; replace only live provider startup.
        return AgentService.create(
            services=Settings(_env_file=None, agent_subagents="fake"), roommate_runtime=roommate_runtime
        )

    monkeypatch.setattr(AgentService, "open", isolated_agent_open)
    async with main.app.router.lifespan_context(main.app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            assert (await client.get("/health")).status_code == 200
            assert (await client.get("/api/v1/roommate/availability")).json()["enabled"] is enabled
            response = await client.post(
                "/api/v1/roommate/access",
                headers={"Authorization": "Bearer test-token", "X-User-Id": "viewer"},
                json={"adult": "0901234567", "terms_version": "roommate-1.0"},
            )
            assert response.status_code in (422, 503)
            assert response.headers["cache-control"] == "private, no-store"
            assert "0901234567" not in response.text
        runtime = main.app.state.roommate_runtime
        assert (runtime is not None) is enabled
        if enabled:
            assert main.app.state.agent_service.deps.agents.get(AgentName.ROOMMATE).runtime is runtime
    assert (tmp_path / "private").exists() is enabled
    if enabled:
        assert runtime.closed
