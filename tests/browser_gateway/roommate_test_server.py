"""Isolated browser fixture: real Roommate services/API/gateway, synthetic people only."""

import os
import secrets
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path

import httpx
from fastapi import FastAPI
from PIL import Image
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
from relohome_gateway.server import create_app
from relohome_gateway.store import password_hash
from relohome_roommate.media import MediaService
from relohome_roommate.models import RoommateProfile
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.contacts import ContactService
from relohome_roommate.services.profiles import ProfileService

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
    # Only the platform is a fixture here; Roommate API, permissions and persistence are real.
    if request.url.path.startswith("/v1/"):
        authorized = (
            request.headers.get("x-user-id") == "fixture-admin"
            and request.headers.get("authorization") == "Bearer roommate-browser-test-token"
        )
        if not authorized:
            return httpx.Response(403, json={"code": "moderator_required"})
        if request.url.path == "/v1/admin/session":
            return httpx.Response(200, json={"can_moderate_housing": True})
        if request.url.path == "/v1/moderation/housing/queue":
            return httpx.Response(200, json={"hosts": [], "properties": [], "listings": []})
        if request.url.path == "/v1/moderation/housing/listings":
            return httpx.Response(200, json={"items": [], "total": 0})
        return httpx.Response(404)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://roommate-test") as client:
        return await client.request(
            request.method, request.url.raw_path.decode(), headers=request.headers, content=request.content
        )


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
            housing_moderator_ids="fixture-admin",
            agent_api_token="roommate-browser-test-token",
        )
    )
    api.state.roommate_runtime = runtime
    api.state.agent_service = AgentService.create(
        services=Settings(_env_file=None, agent_subagents="fake"), roommate_runtime=runtime
    )
    try:
        async with gateway_lifespan(gateway):
            for identifier, name in (
                ("fixture-anna", "Anna"),
                ("fixture-linh", "Linh"),
                ("fixture-admin", "Admin"),
                ("fixture-reviewee", "Reviewee"),
            ):
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
                if identifier == "fixture-admin":
                    continue  # No personal Roommate consent or discovery profile for this Admin.
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
                            "gender": "female",
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
                    if identifier == "fixture-linh":
                        # Seed historical media internally; the upload/attach HTTP routes stay closed.
                        data = BytesIO()
                        Image.new("RGB", (16, 16), "green").save(data, format="PNG")
                        media = MediaService(ctx)
                        photo = media.upload(actor, data.getvalue(), "fixture-legacy-photo-001")["media_id"]
                        media.review(Actor(id="fixture-admin"), photo, True, "Historical fixture photo")
                        media.attach(actor, photo, 2)
            yield
    finally:
        await api.state.agent_service.close()
        runtime.close()


app.router.lifespan_context = lifespan
