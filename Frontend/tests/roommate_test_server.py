"""Isolated browser fixture: real Roommate services/API/gateway, synthetic people only."""

import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from relohome_agent.agents.wiring import AgentService
from relohome_agent.api import (
    roommate_access,
    roommate_connections,
    roommate_discovery,
    roommate_media,
    roommate_notifications,
    roommate_operations,
    roommate_privacy,
    roommate_profiles,
    roommate_safety,
    routes,
)
from relohome_agent.config import Settings
from relohome_agent.roommate_runtime import RoommateRuntime
from relohome_agent.services.adapters.registry import ServiceSettings
from relohome_gateway.server import create_app
from relohome_gateway.store import password_hash

from src.roommate.models import RoommateProfile
from src.roommate.ports import Actor
from src.roommate.services.access import AccessService
from src.roommate.services.contacts import ContactService
from src.roommate.services.profiles import ProfileService

ROOT = Path(__file__).resolve().parents[2]
os.environ.setdefault("RELOHOME_RUNTIME_ROOT", str(ROOT))
STATE = (ROOT / "logs/local" / os.environ.get("ROOMMATE_BROWSER_RUN", "roommate-browser-dev")).resolve()
if not STATE.is_relative_to(ROOT / "logs/local"):
    raise ValueError("Browser fixture state must stay in logs/local")
os.environ["AGENT_API_TOKEN"] = "roommate-browser-test-token"
os.environ["LIFEFLOW_API_BASE_URL"] = "http://roommate-test/api/v1"

api = FastAPI()
for router in (
    routes.router,
    roommate_access.router,
    roommate_discovery.router,
    roommate_profiles.router,
    roommate_connections.router,
    roommate_safety.router,
    roommate_media.router,
    roommate_notifications.router,
    roommate_operations.router,
    roommate_privacy.router,
):
    api.include_router(router, prefix="/api/v1")


async def forward(request):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://roommate-test") as client:
        return await client.request(request.method, request.url.path, headers=request.headers, content=request.content)


app = create_app(STATE / "web.sqlite3", transport=httpx.MockTransport(forward))
gateway_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(gateway):
    runtime = RoommateRuntime.open(
        Settings(
            _env_file=None,
            roommate_enabled=True,
            roommate_state_dir=STATE / "private",
            roommate_moderators="fixture-anna",
            agent_api_token="roommate-browser-test-token",
        )
    )
    api.state.roommate_runtime = runtime
    api.state.agent_service = AgentService.create(
        services=ServiceSettings(_env_file=None, agent_subagents="fake"), roommate_runtime=runtime
    )
    try:
        async with gateway_lifespan(gateway):
            for identifier, name in (("fixture-anna", "Anna"), ("fixture-linh", "Linh")):
                if gateway.state.store.one("SELECT id FROM users WHERE id=?", (identifier,)):
                    continue
                salt = secrets.token_hex(16)
                gateway.state.store.write(
                    "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
                    (
                        identifier,
                        name.lower() + "@roommate.test",
                        name,
                        salt,
                        password_hash("roommate-test-password", salt),
                    ),
                )
                actor = Actor(id=identifier)
                profile = RoommateProfile(
                    display_name=name,
                    introduction="Looking for a considerate roommate. This is a synthetic test profile.",
                    facts={
                        "city": "hcm",
                        "area_ids": ["city:hcm"],
                        "budget": {"min_vnd": 2000000, "max_vnd": 5000000, "fee_basis": "rent_only"},
                        "need": {"kind": "looking_together"},
                        "move_in": {"kind": "flexible"},
                        "self_traits": {
                            "smoking": "non_smoker",
                            "has_pets": False,
                            "cleanliness": "daily",
                            "sociability": "balanced",
                        },
                    },
                )
                with runtime.context() as ctx:
                    AccessService(ctx).accept(actor, True, "roommate-1.0")
                    ProfileService(ctx).save(actor, profile, None)
                    ProfileService(ctx).save_intro(actor, profile)
                    ProfileService(ctx).transition(actor, "publish", 1, True)
                    ContactService(ctx).save(actor, "phone", "0901234567", None, "fixture-contact-" + identifier)
            yield
    finally:
        await api.state.agent_service.close()
        runtime.close()


app.router.lifespan_context = lifespan
