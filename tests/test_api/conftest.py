"""HTTP tests run the application lifecycle with explicitly injected offline services."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from relohome_agent.agents.wiring import AgentService
from relohome_agent.config import Settings
from relohome_agent.main import app


@pytest.fixture
def api_client_factory():
    @asynccontextmanager
    async def connect(service):
        # ASGITransport does not invoke lifespan. Exercise real startup/shutdown,
        # replacing only the live runtime constructor to avoid LLM/provider calls.
        with (
            patch.object(AgentService, "open", new=AsyncMock(return_value=service)) as startup,
            patch.object(app.state, "agent_service", None, create=True),
            patch.object(service, "close", new=AsyncMock(wraps=service.close)) as shutdown,
        ):
            async with app.router.lifespan_context(app):
                startup.assert_awaited_once()
                assert set(startup.await_args.kwargs) == {"roommate_runtime"}
                assert app.state.agent_service is service
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                    yield client
            shutdown.assert_awaited_once_with()

    return connect


@pytest_asyncio.fixture
async def client(api_client_factory):
    service = AgentService.create(services=Settings(_env_file=None, agent_subagents="fake"))
    async with api_client_factory(service) as client:
        yield client
