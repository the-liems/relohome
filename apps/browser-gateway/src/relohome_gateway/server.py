"""ReloHome browser gateway. HttpOnly sessions; service secrets never reach JavaScript.

Run from repository root: npm run dev:gateway
The built Vite app is served here; development Vite proxies /web/api here.
"""

import asyncio
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from opentelemetry.instrumentation.propagators import TraceResponsePropagator, set_global_response_propagator
from pydantic import BaseModel, ConfigDict, Field
from relohome_contracts.moving_options import MovingOptions
from relohome_contracts.schemas import MovingQuoteForm
from relohome_flight.schemas import Contact, Passenger
from relohome_gateway.guest_body_limit import GuestBodyLimit
from relohome_gateway.guest_routes import allowed as guest_route_allowed
from relohome_gateway.guest_sessions import GUEST_COOKIE, TTL, GuestSessions
from relohome_gateway.guest_sessions import enabled as guest_enabled
from relohome_gateway.roommate_gateway import attach_roommate_gateway
from relohome_gateway.runtime_paths import database_path, media_path, runtime_root, traveler_key_path
from relohome_gateway.settings import GatewaySettings
from relohome_gateway.store import Store, TravelerProfiles, password_hash
from relohome_privacy import redact_pii
from relohome_roommate.access import RoommateError
from relohome_roommate.agent_projection import history_projection
from relohome_roommate.media import MAX_IMAGE_BYTES, sanitized_image

logger = logging.getLogger(__name__)
COOKIE = "siu_session"


def housing_media_dir() -> Path:
    """Owner-uploaded listing images; mount persistently in production (runbook: housing-management)."""
    return media_path(runtime_root())


HOUSING_MANAGEMENT_PATHS = (
    re.compile(r"^landlord/(overview|properties|contact-requests|reviews|listings|stats|revenue)$"),
    re.compile(r"^landlord/locations/(search|resolve)$"),
    re.compile(r"^landlord/reviews/[0-9a-f-]+/reply$"),
    re.compile(r"^landlord/properties/[0-9a-f-]+(?:/(?:units|room-listing))?$"),
    re.compile(r"^landlord/units/[0-9a-f-]+(?:/(?:listing|room-listing))?$"),
    re.compile(r"^landlord/listings/[0-9a-f-]+(?:/(?:media|submit|availability|hide|preview))?$"),
    re.compile(r"^landlord/listings/[0-9a-f-]+/media/[0-9a-f-]+$"),
    re.compile(r"^landlord/contact-requests/[0-9a-f-]+(?:/(?:viewing|viewing-options|payment-review|archive))?$"),
    re.compile(r"^housing/[0-9a-f-]+/(?:contact-requests|events|reviews|review)$"),
    re.compile(r"^housing/reviews/[0-9a-f-]+/report$"),
    re.compile(r"^housing/contact-requests/me$"),
    re.compile(r"^housing/contact-notifications$"),
    re.compile(r"^housing/activity(?:/[0-9a-f-]+/read)?$"),
    re.compile(r"^housing/contact-requests/[0-9a-f-]+/(?:cancel|messages|activity)$"),
    re.compile(r"^moderation/housing/(?:queue|properties/[0-9a-f-]+/approve|listings/[0-9a-f-]+/review)$"),
    re.compile(r"^moderation/housing/listings(?:/[0-9a-f-]+)?$"),
    re.compile(r"^moderation/housing/reviews(?:/[0-9a-f-]+/decision)?$"),
    re.compile(r"^moderation/housing/flags/[0-9a-f-]+/review$"),
    re.compile(r"^host/profile$"),
    re.compile(r"^moderation/host/[A-Za-z0-9_-]{1,128}/review$"),
)
# Viewing statuses whose booked time is sent to the landlord, and contact statuses still open.
VIEWING_WITH_SLOT = {"viewing_scheduled", "visit_due", "backup"}
OPEN_CONTACT = {"new", "contacted", "viewing"}


def same_instant(left, right) -> bool:
    try:
        return datetime.fromisoformat(str(left)) == datetime.fromisoformat(str(right))
    except (TypeError, ValueError):
        return False


# Outcome codes the owner workspace acts on (host-mode-design §5); other upstream fields are never forwarded.
HOUSING_MANAGEMENT_CODES = {
    "host_profile_required",
    "host_terms_required",
    "host_not_verified",
    "listing_incomplete",
    "listing_unchanged",
    "revision_conflict",
    "rejection_reason_required",
    "location_confirmation_required",
    "location_unavailable",
    "location_rate_limited",
}


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=180, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=10, max_length=128)
    name: str = Field(default="", max_length=80)


class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    preferences: dict[str, str] = Field(default_factory=dict, max_length=8)


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=16, max_length=80)
    message: str = Field(min_length=1, max_length=5000)
    housing_location: dict | None = None
    moving_locations: dict | None = None
    moving_options: MovingOptions | None = None
    map_view: dict | None = None  # validated again by the Agent API
    place_choice: dict | None = None


class QuoteTurn(MovingQuoteForm):
    request_id: str = Field(min_length=16, max_length=80)


class Traveler(BaseModel):
    """Booker profile; companions are entered per booking and never stored here (payment-design D2/D3)."""

    model_config = ConfigDict(extra="forbid")
    title: Literal["MR", "MRS", "MS"]
    last_name: str = Field(min_length=1, max_length=50)
    first_name: str = Field(min_length=1, max_length=50)
    date_of_birth: str = Field(min_length=10, max_length=10)
    email: str = Field(max_length=180)
    phone: str = Field(max_length=20)


class Companion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["adult", "child", "infant"] = "adult"
    title: Literal["MR", "MRS", "MS", "MSTR", "MISS"]
    last_name: str = Field(min_length=1, max_length=50)
    first_name: str = Field(min_length=1, max_length=50)
    date_of_birth: str = Field(min_length=10, max_length=10)


class PayTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payload_hash: str = Field(min_length=64, max_length=64)
    request_key: str = Field(min_length=16, max_length=80)
    companions: list[Companion] | None = Field(default=None, max_length=8)  # None: not a flight


def ticket_people(traveler: Traveler, companions: list[Companion]) -> dict:
    """Validate with the Flight schema before anything leaves the gateway."""
    try:
        born = date.fromisoformat(traveler.date_of_birth)
    except ValueError:
        raise HTTPException(422, "Ngày sinh người đặt chưa hợp lệ (YYYY-MM-DD).") from None
    today = date.today()
    if today.year - born.year - ((today.month, today.day) < (born.month, born.day)) < 12:
        raise HTTPException(422, "Người đặt vé phải từ 12 tuổi trở lên. Hãy kiểm tra ngày sinh trong hồ sơ.")
    try:
        booker = Passenger(type="adult", **traveler.model_dump(exclude={"email", "phone"}))
        others = [Passenger(**c.model_dump()) for c in companions]
        contact = Contact(email=traveler.email.strip(), phone=traveler.phone.replace(" ", ""))
    except ValueError:
        raise HTTPException(
            422, "Thông tin hành khách chưa hợp lệ. Tên không dấu cũng được, ngày sinh dạng YYYY-MM-DD."
        ) from None
    return {
        "passengers": [p.model_dump(mode="json", exclude_none=True) for p in [booker, *others]],
        "contact": contact.model_dump(mode="json"),
    }


def public_user(row):
    result = {k: row[k] for k in ("id", "email", "name")} | {"preferences": json.loads(row["preferences"])}
    if row.get("workspace") == "admin":
        result["is_admin"] = True
    return result


def presentation(payload, state):
    payload = history_projection(payload)
    results = ((payload.get("response") or {}).get("data") or {}).get("results", {})
    payload["ui"] = {
        "version": 1,
        "plan_version": (state.get("plan") or {}).get("version"),
        "components": [
            {"id": f"{task}:{r.get('fetched_at', '')}", "type": r.get("agent", "unknown"), "task_id": task, **r}
            for task, r in results.items()
        ],
    }
    return payload


def create_app(database=None, transport=None, settings: GatewaySettings | None = None):
    settings = settings or GatewaySettings()
    # The ASGI instrumentation returns each request's trace context as W3C `traceresponse`,
    # so a user or tester can quote the trace behind a failure.
    set_global_response_propagator(TraceResponsePropagator())
    @asynccontextmanager
    async def lifespan(app):
        root = runtime_root()
        path = database_path(root, database)
        key_path = traveler_key_path(path, root)
        if path.exists() and not os.getenv("SIU_TRAVELER_KEY") and not key_path.exists():
            raise ValueError("Existing gateway database requires its original traveler encryption key")
        app.state.store_path = str(path)
        app.state.store = Store(path)
        app.state.guests = GuestSessions(app.state.store)
        app.state.travelers = TravelerProfiles(
            app.state.store,
            key_path,
        )
        app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(250, connect=10), transport=transport)
        app.state.locks = {}
        app.state.attempts = {}
        app.state.cleanup_guests = cleanup_guests
        maintenance = asyncio.create_task(guest_maintenance()) if guest_enabled() else None
        yield
        if maintenance:
            maintenance.cancel()
            with suppress(asyncio.CancelledError):
                await maintenance
        await app.state.http.aclose()
        app.state.store.db.close()

    app = FastAPI(title="ReloHome", lifespan=lifespan, telemetry={"tracing": False})
    app.add_middleware(GuestBodyLimit, gateway=app)
    app.state.store_path = database

    @app.get("/health")
    async def health():
        # Readiness of what this process owns; the proxy keeps this path off the public domain.
        try:
            app.state.store.db.execute("SELECT 1 FROM sqlite_master LIMIT 1")
        except sqlite3.Error:
            return JSONResponse({"status": "not_ready"}, status_code=503)
        return {"status": "ok"}

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"detail": "Vui lòng kiểm tra các trường đã nhập."}, status_code=422)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        if code := getattr(exc, "error_code", None):
            logger.error("Request failed: %s", code)
        if isinstance(exc.detail, dict) and exc.detail.get("code") in {"guest_quota", "guest_expired"}:
            quota = exc.detail["code"] == "guest_quota"
            headers = {"Cache-Control": "no-store"}
            if quota:
                headers["Retry-After"] = str(exc.detail["retry_after"])
            return JSONResponse(
                {
                    **exc.detail,
                    "detail": "Bạn đã dùng hết lượt của phiên khách. Hãy chờ hoặc đăng nhập."
                    if quota
                    else "Phiên khách đã hết hạn. Hãy bắt đầu lại hoặc đăng nhập.",
                },
                status_code=exc.status_code,
                headers=headers,
            )
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.middleware("http")
    async def browser_boundary(request, call_next):
        if request.url.path.startswith("/web/api") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if request.headers.get("x-siu-request") != "1" or (
                origin and urlsplit(origin).netloc != request.headers.get("host")
            ):
                return JSONResponse({"detail": "Phiên yêu cầu không hợp lệ. Hãy tải lại trang."}, status_code=403)
        if guest_enabled() and request.url.path.startswith("/web/api"):
            account = app.state.store.session_user(request.cookies.get(COOKIE, ""))
            if not account:
                try:
                    app.state.guests.request_budget(request.client.host if request.client else "unknown")
                except HTTPException as exc:
                    return JSONResponse(
                        {"code": "guest_quota", "detail": "Bạn đã gửi nhiều yêu cầu. Hãy chờ một chút."},
                        status_code=exc.status_code,
                        headers={"Retry-After": str(exc.detail["retry_after"]), "Cache-Control": "no-store"},
                    )
            if not account and not guest_route_allowed(request.url.path, request.method):
                return JSONResponse(
                    {"code": "authentication_required", "detail": "Đăng nhập để sử dụng chức năng này."},
                    status_code=401,
                    headers={"Cache-Control": "no-store"},
                )
            if not account and request.url.path == "/web/api/roommate/availability":
                return JSONResponse({"enabled": False, "requires_account": True}, headers={"Cache-Control": "no-store"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/web/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def user(request):
        row = app.state.store.session_user(request.cookies.get(COOKIE, ""))
        if not row:
            raise HTTPException(401, "Vui lòng đăng nhập để tiếp tục.")
        return row

    def actor(request):
        if not guest_enabled():
            return user(request)
        row = app.state.store.session_user(request.cookies.get(COOKIE, ""))
        if row:
            return row
        guest = app.state.guests.lookup(request.cookies.get(GUEST_COOKIE, ""))
        if not guest:
            raise HTTPException(401, {"code": "guest_expired"})
        if guest["claim_target"]:
            raise HTTPException(409, "Phiên đang được chuyển sang tài khoản. Hãy thử đăng nhập lại.")
        return guest

    async def object_body(request):
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(422, "Dữ liệu yêu cầu chưa hợp lệ.") from None
        if not isinstance(body, dict):
            raise HTTPException(422, "Dữ liệu yêu cầu phải là một đối tượng.")
        return body

    def owned(thread, owner):
        row = app.state.store.one("SELECT * FROM threads WHERE id=? AND owner=?", (thread, owner))
        if not row:
            raise HTTPException(404, "Không tìm thấy hội thoại.")
        return row

    def snapshot(thread, owner):
        row = owned(thread, owner)
        return {
            **row,
            "state": history_projection(json.loads(row["state"])),
            "messages": history_projection(app.state.store.history(thread)),
            "runs": app.state.store.all(
                "SELECT id,status FROM runs WHERE thread=? AND owner=? AND status IN ('running','unknown')",
                (thread, owner),
            ),
        }

    async def upstream(method, path, owner, body=None, platform=False, extra_headers=None):
        base = settings.siu_platform_api_url if platform else settings.lifeflow_api_base_url
        token = settings.agent_api_token.get_secret_value()
        if not token and not platform:
            error = HTTPException(503, "Chưa kết nối được hệ thống AI. Vui lòng kiểm tra cấu hình máy chủ.")
            error.error_code = "missing_agent_api_token"
            raise error
        try:
            response = await app.state.http.request(
                method,
                base.rstrip("/") + path,
                headers={**(extra_headers or {}), "Authorization": "Bearer " + token, "X-User-Id": owner},
                json=body,
            )
            data = response.json()
        except (httpx.RequestError, ValueError) as exc:
            detail = "Chưa nhận được kết quả từ dịch vụ. Kiểm tra trạng thái trước khi gửi lại."
            if isinstance(exc, ValueError):
                error = HTTPException(502, detail)
                error.error_code = "upstream_invalid_json"
                raise error from None
            logger.warning(
                "upstream request failed target=%s method=%s path=%s",
                "platform" if platform else "backend",
                method,
                path,
                exc_info=True,
            )
            raise HTTPException(502, detail) from None
        if not response.is_success:
            detail = data.get("detail", data.get("message", "Dịch vụ chưa xử lý được yêu cầu."))
            # Preserve only documented route outcomes so the browser can distinguish
            # a road-snapping failure from GPS denial. Never forward arbitrary fields.
            if platform and (
                path in {"/routes/entities", "/routes/device"}
                and data.get("code")
                in {"NO_ROUTE", "OUTSIDE_ROUTING_AREA", "OSRM_OFFLINE", "INVALID_RESPONSE", "TIMEOUT", "CANCELLED"}
                or data.get("code") in HOUSING_MANAGEMENT_CODES
            ):
                return JSONResponse(
                    {
                        "detail": detail if isinstance(detail, str) else "Chưa tính được tuyến đường.",
                        "code": data["code"],
                        **(
                            {
                                "fields": {
                                    k: v
                                    for k, v in data["fields"].items()
                                    if k
                                    in {
                                        "listing",
                                        "title",
                                        "description",
                                        "address",
                                        "location",
                                        "rent_vnd",
                                        "area_m2",
                                        "property_type",
                                        "images",
                                    }
                                    and isinstance(v, str)
                                }
                            }
                            if isinstance(data.get("fields"), dict)
                            else {}
                        ),
                    },
                    status_code=response.status_code,
                )
            raise HTTPException(response.status_code, detail if isinstance(detail, str) else "Dữ liệu gửi chưa hợp lệ.")
        return data

    async def refresh(thread, owner):
        try:
            state = await upstream("GET", f"/chat/{thread}/state", owner)
            app.state.store.write(
                "UPDATE threads SET state=? WHERE id=? AND owner=?", (json.dumps(state), thread, owner)
            )
        except HTTPException:
            pass  # Stored history remains usable when an individual service is offline.

    async def claim_guest(request, account):
        guest = app.state.guests.lookup(request.cookies.get(GUEST_COOKIE, ""))
        if not guest:
            return
        await finish_guest_claim(guest, account)

    async def finish_guest_claim(guest, account):
        if guest["claim_target"] and guest["claim_target"] != account:
            raise HTTPException(409, "Phiên đang được nhận bởi tài khoản khác.")
        thread = guest["thread"]
        lock = app.state.locks.setdefault(thread or guest["id"], asyncio.Lock())
        if lock.locked():
            raise HTTPException(409, "Chờ lượt chat đang chạy hoàn tất rồi đăng nhập.")
        async with lock:
            key = guest["claim_key"] or secrets.token_hex(24)
            app.state.store.write(
                "UPDATE guest_sessions SET claim_target=?,claim_key=? WHERE id=?",
                (account, key, guest["id"]),
            )
            if thread:
                result = await upstream(
                    "POST",
                    "/chat/guest-claim",
                    guest["id"],
                    {
                        "thread_id": thread,
                        "target_user": account,
                        "operation_key": key,
                    },
                )
                if not isinstance(result, dict) or result.get("claimed") is not True:
                    raise HTTPException(503, "Chưa nhận được hội thoại. Hãy thử đăng nhập lại.")
            with app.state.store.db:
                if thread:
                    app.state.store.db.execute(
                        "UPDATE threads SET owner=? WHERE id=? AND owner=?", (account, thread, guest["id"])
                    )
                    app.state.store.db.execute(
                        "UPDATE runs SET owner=? WHERE thread=? AND owner=?", (account, thread, guest["id"])
                    )
                app.state.store.db.execute("UPDATE guest_sessions SET claimed=1 WHERE id=?", (guest["id"],))

    @app.get("/web/api/session")
    async def session(request: Request, response: Response):
        row = app.state.store.session_user(request.cookies.get(COOKIE, ""))
        if not row and guest_enabled():
            guest = app.state.guests.lookup(request.cookies.get(GUEST_COOKIE, ""))
            if not guest:
                token, guest = app.state.guests.create(request.client.host if request.client else "unknown")
                response.set_cookie(
                    GUEST_COOKIE,
                    token,
                    httponly=True,
                    secure=settings.siu_secure_cookie,
                    samesite="strict",
                    max_age=TTL,
                    path="/",
                )
            return app.state.guests.public(guest)
        row = row or user(request)
        if row.get("workspace") == "admin":
            capability = await upstream("GET", "/admin/session", row["id"], platform=True)
            if isinstance(capability, JSONResponse):
                return capability
            if not isinstance(capability, dict) or capability.get("can_moderate_housing") is not True:
                raise HTTPException(403, "Tài khoản này không còn quyền Admin.")
        return public_user(row)

    @app.post("/web/api/auth/{action}")
    async def auth(
        action: Literal["login", "register", "admin"], body: Credentials, request: Request, response: Response
    ):
        peer = request.client.host if request.client else "unknown"
        now = time.time()
        attempts = [x for x in app.state.attempts.get(peer, []) if x > now - 300]
        if len(attempts) >= 15:
            raise HTTPException(429, "Bạn đã thử nhiều lần. Vui lòng chờ vài phút.")
        app.state.attempts[peer] = [*attempts, now]
        email = body.email.strip().lower()
        store = app.state.store
        if action == "register":
            if not settings.siu_allow_registration:
                raise HTTPException(403, "Máy chủ chưa mở đăng ký tài khoản.")
            if not body.name.strip():
                raise HTTPException(422, "Vui lòng nhập tên hiển thị.")
            salt = secrets.token_hex(16)
            hashed = await asyncio.to_thread(password_hash, body.password, salt)
            try:
                store.write(
                    "INSERT INTO users(id,email,name,salt,password) VALUES (?,?,?,?,?)",
                    (secrets.token_hex(16), email, body.name.strip(), salt, hashed),
                )
            except sqlite3.IntegrityError:
                raise HTTPException(409, "Không thể tạo tài khoản với email này. Hãy đăng nhập.") from None
        row = store.one("SELECT * FROM users WHERE email=?", (email,))
        hashed = await asyncio.to_thread(password_hash, body.password, row["salt"] if row else "00" * 16)
        if not row or not secrets.compare_digest(row["password"], hashed):
            raise HTTPException(401, "Email hoặc mật khẩu chưa đúng.")
        if action == "admin":
            capability = await upstream("GET", "/admin/session", row["id"], platform=True)
            if not isinstance(capability, dict) or capability.get("can_moderate_housing") is not True:
                raise HTTPException(403, "Tài khoản này không có quyền Admin.")
        workspace = "admin" if action == "admin" else "customer"
        if action != "admin":
            await claim_guest(request, row["id"])
        token = store.create_session(row["id"], workspace)
        row["workspace"] = workspace
        response.set_cookie(
            COOKIE,
            token,
            httponly=True,
            secure=settings.siu_secure_cookie,
            samesite="strict",
            max_age=86400 * 14,
            path="/",
        )
        response.delete_cookie(GUEST_COOKIE, path="/")
        return public_user(row)

    @app.post("/web/api/logout")
    async def logout(request: Request, response: Response):
        app.state.store.write(
            "DELETE FROM sessions WHERE token=?",
            (hashlib.sha256(request.cookies.get(COOKIE, "").encode()).hexdigest(),),
        )
        response.delete_cookie(COOKIE, path="/")
        guest = app.state.guests.lookup(request.cookies.get(GUEST_COOKIE, ""))
        if guest and not guest["claim_target"]:
            app.state.store.write("UPDATE guest_sessions SET expires=? WHERE id=?", (time.time() - 1, guest["id"]))
        response.delete_cookie(GUEST_COOKIE, path="/")
        return {"ok": True}

    @app.patch("/web/api/profile")
    async def profile(body: Profile, request: Request):
        owner = user(request)["id"]
        allowed = {"city", "budget", "room_type", "transport", "amenities"}
        if any(k not in allowed or len(v) > 300 for k, v in body.preferences.items()):
            raise HTTPException(422, "Tùy chọn chưa hợp lệ.")
        app.state.store.write(
            "UPDATE users SET name=?, preferences=? WHERE id=?",
            (body.name.strip(), json.dumps(body.preferences), owner),
        )
        return public_user(app.state.store.one("SELECT * FROM users WHERE id=?", (owner,)))

    @app.get("/web/api/status")
    async def status(request: Request):
        return await upstream("GET", "/status", actor(request)["id"])

    @app.get("/web/api/threads")
    async def threads(request: Request):
        return [
            {**r, "state": json.loads(r["state"])}
            for r in app.state.store.all(
                "SELECT id,title,updated,state,revision FROM threads WHERE owner=? ORDER BY updated DESC",
                (actor(request)["id"],),
            )
        ]

    @app.post("/web/api/threads")
    async def new_thread(request: Request):
        principal = actor(request)
        owner, thread = principal["id"], "th_" + secrets.token_hex(16)
        if owner.startswith("guest_"):
            with app.state.store.db:
                # Lock before reading, so simultaneous creations cannot orphan a thread.
                app.state.store.db.execute("UPDATE guest_sessions SET expires=expires WHERE id=?", (owner,))
                current = app.state.store.one("SELECT thread,claim_target FROM guest_sessions WHERE id=?", (owner,))
                if current["claim_target"]:
                    raise HTTPException(409, "Phiên đang được chuyển sang tài khoản.")
                if current["thread"]:
                    return snapshot(current["thread"], owner)
                app.state.store.db.execute(
                    "INSERT INTO threads(id,owner,title,updated) VALUES (?,?,?,?)",
                    (thread, owner, "Cuộc trò chuyện mới", time.time()),
                )
                app.state.store.db.execute("UPDATE guest_sessions SET thread=? WHERE id=?", (thread, owner))
            return snapshot(thread, owner)
        app.state.store.write(
            "INSERT INTO threads(id,owner,title,updated) VALUES (?,?,?,?)",
            (thread, owner, "Cuộc trò chuyện mới", time.time()),
        )
        return snapshot(thread, owner)

    @app.get("/web/api/threads/{thread}")
    async def get_thread(thread: str, request: Request):
        owner = actor(request)["id"]
        owned(thread, owner)
        await refresh(thread, owner)
        result = snapshot(thread, owner)
        if isinstance(result["state"], dict) and result["state"].get("viewing"):
            # The plan's "Xem nhà" tab reads this copy; show the landlord's answer there too.
            await landlord_viewings(owner, result["state"]["viewing"], thread=thread)
        return result

    async def remove_thread(thread, owner):
        row = owned(thread, owner)
        lock = app.state.locks.setdefault(thread, asyncio.Lock())
        if lock.locked():
            raise HTTPException(409, "Hội thoại đang xử lý một yêu cầu. Chờ xong rồi xóa.")
        async with lock:
            if row["revision"] or app.state.store.history(thread):
                # The agent keeps its own checkpoint and memory for this thread; delete those first so a
                # failure never leaves agent state behind a conversation the user no longer sees.
                await upstream("DELETE", f"/chat/{thread}", owner)
            app.state.store.delete_thread(owner, thread)
        app.state.locks.pop(thread, None)

    async def cleanup_guests():
        # Reconcile claims whose credentials were already verified, including after restart.
        for row in app.state.store.all(
            "SELECT * FROM guest_sessions WHERE claimed=0 AND claim_target IS NOT NULL LIMIT 5"
        ):
            try:
                await finish_guest_claim(row, row["claim_target"])
            except Exception as exc:
                logger.warning("guest claim reconcile failed: %s", type(exc).__name__, exc_info=True)
        for row in app.state.store.all(
            "SELECT * FROM guest_sessions WHERE claimed=0 AND claim_target IS NULL AND expires<=? LIMIT 10",
            (time.time(),),
        ):
            try:
                if row["thread"]:
                    await remove_thread(row["thread"], row["id"])
                app.state.store.write("DELETE FROM guest_sessions WHERE id=?", (row["id"],))
            except Exception as exc:
                logger.warning("guest expiry cleanup failed: %s", type(exc).__name__, exc_info=True)
        app.state.store.write("DELETE FROM guest_sessions WHERE claimed=1")

    async def guest_maintenance():
        while True:
            await asyncio.sleep(60)
            await cleanup_guests()

    @app.delete("/web/api/threads/{thread}")
    async def delete_thread(thread: str, request: Request):
        owner = actor(request)["id"]
        await remove_thread(thread, owner)
        app.state.store.write("UPDATE guest_sessions SET thread=NULL WHERE id=? AND thread=?", (owner, thread))
        return {"ok": True}

    @app.delete("/web/api/threads")
    async def reset_threads(request: Request):
        """Delete every conversation that can be deleted and make the agent forget learned preferences."""
        owner = user(request)["id"]
        deleted, kept = 0, []
        for row in app.state.store.all("SELECT id,title FROM threads WHERE owner=?", (owner,)):
            try:
                await remove_thread(row["id"], owner)
                deleted += 1
            except HTTPException as exc:
                kept.append({**row, "detail": exc.detail})
        try:
            await upstream("DELETE", "/memory", owner)
            forgotten = True
        except HTTPException:
            forgotten = False
        return {"deleted": deleted, "kept": kept, "memory_forgotten": forgotten}

    async def run(thread, owner, request_id, path, body, label, guest_peer=None):
        if not isinstance(request_id, str) or not 16 <= len(request_id) <= 80:
            raise HTTPException(422, "Thiếu mã yêu cầu.")
        owned(thread, owner)
        fingerprint = hashlib.sha256(json.dumps({"path": path, "body": body}, sort_keys=True).encode()).hexdigest()
        existing = app.state.store.one("SELECT * FROM runs WHERE id=?", (request_id,))
        if existing:
            if existing["owner"] != owner or existing["thread"] != thread or existing["fingerprint"] != fingerprint:
                raise HTTPException(409, "Yêu cầu đã được dùng cho thao tác khác.")
            if existing["status"] == "done":
                return snapshot(thread, owner)
            raise HTTPException(409, "Yêu cầu đang xử lý hoặc cần kiểm tra trạng thái. Không gửi lặp.")
        lock = app.state.locks.setdefault(thread, asyncio.Lock())
        if lock.locked():
            raise HTTPException(409, "Hội thoại đang xử lý. Hãy chờ kết quả.")
        async with lock:
            if guest_peer is not None and owner.startswith("guest_"):
                app.state.guests.budget({"id": owner}, guest_peer)
            app.state.store.write(
                "INSERT INTO runs VALUES (?,?,?,?,?,NULL)", (request_id, owner, thread, fingerprint, "running")
            )
            app.state.store.message(thread, "user", {"text": redact_pii(label)})
            try:
                payload = await upstream("POST", path, owner, body)
                await refresh(thread, owner)
                state = json.loads(owned(thread, owner)["state"])
                app.state.store.message(thread, "assistant", presentation(payload, state))
                app.state.store.write("UPDATE runs SET status='done' WHERE id=?", (request_id,))
                app.state.store.write(
                    "UPDATE threads SET updated=?, revision=revision+1, title=CASE WHEN title='Cuộc trò chuyện mới' THEN ? ELSE title END WHERE id=?",
                    (time.time(), redact_pii(label)[:80], thread),
                )
            except HTTPException as exc:
                uncertain = exc.status_code >= 500
                app.state.store.write(
                    "UPDATE runs SET status=? WHERE id=?", ("unknown" if uncertain else "failed", request_id)
                )
                app.state.store.message(
                    thread,
                    "assistant",
                    {
                        "status": "done",
                        "response": {"kind": "ERROR", "text": exc.detail, "data": {}},
                        "uncertain": uncertain,
                    },
                )
                raise
            return snapshot(thread, owner)

    @app.post("/web/api/threads/{thread}/chat")
    async def chat(thread: str, body: Turn, request: Request):
        principal = actor(request)
        return await run(
            thread,
            principal["id"],
            body.request_id,
            "/chat",
            {**body.model_dump(exclude={"request_id"}), "thread_id": thread},
            body.message,
            guest_peer=request.client.host if request.client else "unknown",
        )

    @app.post("/web/api/threads/{thread}/action")
    async def action(thread: str, request: Request):
        body = await object_body(request)
        request_id = body.pop("request_id", "")
        if not isinstance(request_id, str) or not 16 <= len(request_id) <= 80:
            raise HTTPException(422, "Thiếu mã yêu cầu.")
        return await run(
            thread,
            actor(request)["id"],
            request_id,
            f"/ui/chat/{thread}/action",
            body,
            "Xem thêm kết quả" if body.get("kind") == "more" else "Chọn phương án vào kế hoạch",
        )

    @app.post("/web/api/threads/{thread}/moving/quote")
    async def moving_quote(thread: str, body: QuoteTurn, request: Request):
        return await run(
            thread,
            user(request)["id"],
            body.request_id,
            f"/ui/chat/{thread}/moving/quote",
            body.model_dump(mode="json", exclude={"request_id"}),
            f"Báo giá chuyển đồ từ form ngày {body.move_date.isoformat()} lúc {body.move_time}. Chưa đặt đơn.",
        )

    @app.post("/web/api/threads/{thread}/decision")
    async def decision(thread: str, request: Request):
        body = await object_body(request)
        request_id = body.pop("request_id", "")
        if not isinstance(request_id, str) or not 16 <= len(request_id) <= 80:
            raise HTTPException(422, "Thiếu mã yêu cầu.")
        # PII forms are sent upstream, never persisted in messages or request logs.
        return await run(
            thread,
            user(request)["id"],
            request_id,
            f"/chat/{thread}/decision",
            body,
            {
                "CONFIRM": "Xác nhận phương án",
                "CHANGE": "Yêu cầu đổi phương án",
                "REJECT": "Từ chối phương án",
                "CANCEL": "Dừng phương án",
            }.get(body.get("kind"), "Phản hồi phương án"),
        )

    @app.post("/web/api/threads/{thread}/payment/{action}")
    async def payment(thread: str, action: Literal["check", "cancel"], request: Request):
        body = await object_body(request)
        return await run(
            thread,
            user(request)["id"],
            str(body.get("request_id", "")),
            f"/chat/{thread}/payment/{action}",
            {},
            "Kiểm tra thanh toán" if action == "check" else "Yêu cầu hủy thanh toán",
        )

    @app.get("/web/api/threads/{thread}/payment/qr.svg")
    async def payment_qr(thread: str, request: Request):
        owner = user(request)["id"]
        row = owned(thread, owner)
        pending = json.loads(row["state"]).get("pending") or {}
        code = pending.get("qr_code")
        if pending.get("type") != "payment_required" or not isinstance(code, str) or not 1 <= len(code) <= 4096:
            raise HTTPException(404, "Không có mã QR cho thanh toán hiện tại.")
        import segno

        output = io.BytesIO()
        segno.make(code, micro=False).save(output, kind="svg", scale=6, xmldecl=False)
        return Response(output.getvalue(), media_type="image/svg+xml")

    # --- In-app payment (payment-design §7–§10). Typed calls straight to the Agent API: no LLM, no chat message.

    async def checkout_call(method, path, owner, body=None):
        token = settings.agent_api_token.get_secret_value()
        if not token:
            error = HTTPException(503, "Chưa kết nối được hệ thống AI. Vui lòng kiểm tra cấu hình máy chủ.")
            error.error_code = "missing_agent_api_token"
            raise error
        base = settings.lifeflow_api_base_url
        try:
            response = await app.state.http.request(
                method,
                base.rstrip("/") + path,
                headers={"Authorization": "Bearer " + token, "X-User-Id": owner},
                json=body,
            )
            data = response.json()
        except (httpx.RequestError, ValueError) as exc:
            # The payment may exist upstream; the UI checks status instead of paying again.
            content = {"detail": "Chưa nhận được phản hồi. Hãy bấm Kiểm tra trước khi thử lại.", "code": "uncertain"}
            if isinstance(exc, ValueError):
                logger.error("Upstream response is not valid JSON")
                return JSONResponse(content, status_code=502)
            logger.warning("upstream request failed target=backend method=%s path=%s", method, path, exc_info=True)
            return JSONResponse(content, status_code=502)
        if not response.is_success:
            detail = data.get("detail") if isinstance(data, dict) else None
            return JSONResponse(
                {
                    "detail": detail if isinstance(detail, str) else "Dịch vụ chưa xử lý được yêu cầu.",
                    "code": data.get("code") if isinstance(data, dict) else None,
                },
                status_code=response.status_code,
            )
        return data

    def traveler(owner):
        data = app.state.travelers.get(owner)
        return Traveler.model_validate(data) if data else None

    @app.get("/web/api/profile/traveler")
    async def get_traveler(request: Request):
        found = traveler(user(request)["id"])
        return {"traveler": found.model_dump() if found else None}

    @app.put("/web/api/profile/traveler")
    async def put_traveler(body: Traveler, request: Request):
        ticket_people(body, [])  # same rules as the ticket, checked before saving
        app.state.travelers.put(user(request)["id"], body.model_dump())
        return {"traveler": body.model_dump()}

    @app.delete("/web/api/profile/traveler")
    async def delete_traveler(request: Request):
        app.state.travelers.delete(user(request)["id"])
        return {"ok": True}

    @app.get("/web/api/threads/{thread}/checkout")
    async def thread_checkout(thread: str, request: Request):
        owner = actor(request)["id"]
        owned(thread, owner)
        return await checkout_call("GET", f"/ui/chat/{thread}/checkout", owner)

    @app.post("/web/api/threads/{thread}/checkout/summary")
    async def checkout_summary(thread: str, request: Request):
        owner, body = user(request)["id"], await object_body(request)
        owned(thread, owner)
        return await checkout_call("POST", f"/ui/chat/{thread}/checkout/summary", owner, {"domain": body.get("domain")})

    @app.post("/web/api/checkout/{transaction}/pay")
    async def checkout_pay(transaction: str, body: PayTurn, request: Request):
        owner = user(request)["id"]
        payload = {"payload_hash": body.payload_hash, "request_key": body.request_key}
        if body.companions is not None:
            booker = traveler(owner)
            if booker is None:
                raise HTTPException(422, "Hãy điền hồ sơ người đặt vé trong Tài khoản trước khi thanh toán vé.")
            payload["passengers"] = ticket_people(booker, body.companions)
        return await checkout_call("POST", f"/ui/checkout/{transaction}/pay", owner, payload)

    @app.post("/web/api/checkout/attempts/{attempt}/{action}")
    async def checkout_attempt(attempt: str, action: Literal["check", "tester-paid"], request: Request):
        return await checkout_call("POST", f"/ui/checkout/attempts/{attempt}/{action}", user(request)["id"])

    @app.get("/web/api/checkout/attempts/{attempt}/qr.svg")
    async def checkout_qr(attempt: str, request: Request):
        data = await checkout_call("GET", f"/ui/checkout/attempts/{attempt}/qr", user(request)["id"])
        if isinstance(data, Response):
            return data
        code = data.get("qr_code")
        if not isinstance(code, str) or not 1 <= len(code) <= 4096:
            raise HTTPException(404, "Không có mã QR cho lần thanh toán này.")
        import segno

        output = io.BytesIO()
        segno.make(code, micro=False).save(output, kind="svg", scale=6, xmldecl=False)
        return Response(output.getvalue(), media_type="image/svg+xml")

    @app.post("/web/api/threads/{thread}/housing/{step}")
    async def housing_step(thread: str, step: Literal["viewing", "agreement", "paid"], request: Request):
        owner, body = user(request)["id"], await object_body(request)
        owned(thread, owner)
        return await checkout_call("POST", f"/ui/chat/{thread}/housing/{step}", owner, body)

    # --- Choose several homes, schedule viewings, decide one (docs/review/housing-viewing-design.md).

    def pending_changes(owner, thread):
        rows = app.state.store.all(
            "SELECT listing, slot, baseline FROM landlord_sync WHERE owner=? AND thread=?", (owner, thread)
        )
        return {row["listing"]: (row["slot"], row["baseline"]) for row in rows}

    def fingerprint(row):
        """What a landlord-inbox write changes on the request: tells whether a timed-out send landed."""
        if not row:
            return json.dumps({"attempted": True, "id": None})
        return json.dumps({"attempted": True, "id": row.get("id"), "at": str(row.get("viewing_updated_at"))})

    def closed_viewing_request(row):
        return bool(row) and (row.get("status") not in OPEN_CONTACT or row.get("viewing_status") == "cancelled")

    async def write_viewing(owner, listing, slot):
        """Send a booked time (or withdraw when slot is empty): 'done', 'not_managed' or 'failed'."""
        try:
            if slot:
                result = await upstream("PUT", f"/housing/{listing}/viewing", owner, {"slot": slot}, platform=True)
            else:
                result = await upstream("DELETE", f"/housing/{listing}/viewing", owner, platform=True)
        except HTTPException as exc:
            return "not_managed" if exc.status_code in {404, 409, 422} else "failed"
        if isinstance(result, JSONResponse):  # documented outcome code forwarded by upstream()
            return "not_managed" if result.status_code in {404, 409, 422} else "failed"
        return "done"

    async def landlord_viewings(owner, view, thread=None, scheduled=None, sync=False):
        """Show the landlord's answer on booked viewings of owner-managed homes
        (docs/review/viewing-landlord-confirmation.md).

        Reads (`sync=False`) never write, so a request the tenant or landlord closed is not reopened by
        opening a page. A viewing step writes:
        - the home the tenant just booked (`scheduled`) is sent; an explicit booking may recreate a closed
          request at the same time (rebooking);
        - homes that lost their time are withdrawn;
        - a write that failed is kept as a pending change, shown (`landlord.sync = "failed"`,
          `landlord_withdraw_pending`) and retried on later viewing steps. A retry never recreates a request:
          closed or cancelled requests are respected even if they retain an older time. Otherwise,
          when the remote request changed since the failed attempt (the timed-out write landed and the
          landlord may have answered or closed it) the change counts as delivered. Pending changes are
          dropped when the booking changes. Other sources answer `not_managed` and keep test mode."""
        if not isinstance(view, dict) or not isinstance(view.get("items"), list):
            return view
        store = app.state.store
        slots = {
            item["listing_id"]: item["viewing"]["slot"]
            for item in view["items"]
            if item.get("status") in VIEWING_WITH_SLOT and (item.get("viewing") or {}).get("slot")
        }
        settled = {"visited", "agreed", "reported_paid"}  # the visit happened: keep the landlord's answer
        pending = pending_changes(owner, thread) if thread else {}

        def forget(listing):
            store.write("DELETE FROM landlord_sync WHERE owner=? AND thread=? AND listing=?", (owner, thread, listing))
            pending.pop(listing, None)

        def remember(listing, slot, baseline):
            store.write(
                "INSERT OR REPLACE INTO landlord_sync VALUES (?,?,?,?,?,?)",
                (owner, thread, listing, slot, time.time(), baseline),
            )
            pending[listing] = (slot, baseline)

        async def requests():
            page = await upstream("GET", "/housing/contact-requests/me", owner, platform=True)
            latest = {}
            for row in page.get("items", []):  # newest first
                latest.setdefault(row["listing_id"], row)
            return latest

        def mark(latest):
            # Only withdrawals that were attempted and failed are known to be outstanding.
            withdrawing = [listing for listing, (slot, baseline) in pending.items() if not slot and baseline]
            if withdrawing:
                view["landlord_withdraw_pending"] = withdrawing
            for item in view["items"]:
                listing, slot = item["listing_id"], (item.get("viewing") or {}).get("slot")
                row = latest.get(listing) if latest else None
                wanted = pending.get(listing, ("", ""))[0]
                if wanted and slot and same_instant(wanted, slot):
                    item["landlord"] = {"sync": "failed"}  # this booking has not reached the landlord
                elif (
                    row
                    and row.get("viewing_status")
                    and slot
                    and (same_instant(row.get("viewing_slot"), slot) or closed_viewing_request(row))
                ):
                    item["landlord"] = {
                        "viewing_status": row["viewing_status"],
                        "request_status": row["status"],
                        "request_id": row.get("id"),
                        "unread": row.get("unread", 0),
                        "viewing_options": row.get("viewing_options", []),
                    }
                if (
                    row
                    and row.get("payment_report")
                    and item.get("reported_payment")
                    and ((item.get("reported_payment") or {}).get("report_key") or item.get("transaction_id"))
                    == row["payment_report"].get("report_key")
                ):
                    item["payment_report"] = row["payment_report"]
                elif item.get("reported_payment") and row:
                    item["payment_sync"] = "failed"
                landlord = item.get("landlord") or {}
                options = landlord.get("viewing_options") or []
                if options and landlord.get("request_status") in OPEN_CONTACT:
                    item["available_slots"] = [
                        candidate
                        for candidate in view.get("slots", [])
                        if any(same_instant(candidate, option) for option in options)
                    ]
                elif landlord.get("viewing_status") == "declined" and landlord.get("request_status") in OPEN_CONTACT:
                    item["available_slots"] = []
            return view

        # What this step wants the landlord inbox to hold: a time per booked home, or a withdrawal.
        intents = {}
        if sync and thread:
            for listing, (slot, _) in list(pending.items()):
                if slot and not same_instant(slots.get(listing), slot):
                    forget(listing)  # cancelled, unselected or rebooked: the withdraw rule below decides
            if scheduled and scheduled in slots:
                intents[scheduled] = (slots[scheduled], True)
            for listing, (slot, _) in pending.items():
                if slot and listing not in intents:
                    intents[listing] = (slot, False)
            for item in [*(view.get("history") or []), *view["items"]]:
                listing = item["listing_id"]
                if listing not in slots and item.get("status") not in settled:
                    intents.setdefault(listing, ("", False))
            for listing, (slot, _) in pending.items():
                if not slot and listing not in slots:
                    intents.setdefault(listing, ("", False))
        try:
            latest = await requests()
        except HTTPException:
            for listing, (slot, _) in intents.items():
                # Not attempted now: keep the fingerprint of an earlier failed attempt, if any.
                remember(listing, slot, pending.get(listing, ("", ""))[1])
            view["landlord_unavailable"] = True
            return mark(None)
        if not intents:
            return mark(latest)
        writes = []
        for listing, (slot, explicit) in intents.items():
            row = latest.get(listing)
            open_row = bool(row) and row.get("status") in OPEN_CONTACT
            if not slot:
                if open_row and row.get("viewing_status") in {"requested", "confirmed"}:
                    writes.append((listing, slot))
                elif listing in pending:
                    forget(listing)  # nothing left to withdraw
                continue
            if not explicit and closed_viewing_request(row):
                forget(listing)  # closure wins over a failed time change; only a new booking may reopen it
                continue
            holds = row is not None and same_instant(row.get("viewing_slot"), slot)
            if holds and open_row and row.get("viewing_status") in {"requested", "confirmed", "declined"}:
                if listing in pending:
                    forget(listing)  # the landlord already has this time and may have answered
                continue
            baseline = pending.get(listing, ("", ""))[1]
            if not explicit and holds and baseline and baseline != fingerprint(row):
                forget(listing)  # the timed-out write landed; respect what happened to it since
                continue
            writes.append((listing, slot))
        results = await asyncio.gather(*(write_viewing(owner, listing, slot) for listing, slot in writes))
        for (listing, slot), result in zip(writes, results, strict=True):
            if result == "failed":
                remember(listing, slot, fingerprint(latest.get(listing)))
            else:
                forget(listing)
        if writes:
            try:
                latest = await requests()
            except HTTPException:
                view["landlord_unavailable"] = True
                return mark(None)
        return mark(latest)

    @app.get("/web/api/threads/{thread}/viewings")
    async def thread_viewings(thread: str, request: Request):
        owner = actor(request)["id"]
        owned(thread, owner)
        if owner.startswith("guest_"):
            return await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner)
        return await landlord_viewings(
            owner, await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner), thread=thread
        )

    @app.get("/web/api/landlord/viewing-options")
    async def landlord_slots(request: Request):
        return await checkout_call("GET", "/ui/viewings/slots", user(request)["id"])

    async def sync_reported_payments(owner, view):
        if not isinstance(view, dict):
            return view
        for item in view.get("items", []):
            payment = item.get("reported_payment")
            if not payment:
                continue
            if item.get("payment_report") and item["payment_report"].get("report_key") == (
                payment.get("report_key") or item.get("transaction_id")
            ):
                continue
            # An existing confirmed contact remains valid if its listing is hidden or rented.
            # Public detail is only needed to identify homes without a known managed contact.
            if not (item.get("landlord") or {}).get("request_id"):
                try:
                    detail = await upstream("GET", f"/housing/{item['listing_id']}", owner, platform=True)
                except HTTPException:
                    item["payment_sync"] = "failed"
                    continue
                if not isinstance(detail, dict) or not detail.get("management"):
                    continue
            payload = {
                "report_key": payment.get("report_key") or item.get("transaction_id"),
                "amount_vnd": payment["amount_vnd"],
                "paid_on": payment["paid_on"],
                "agreement": item.get("agreement") or {},
            }
            try:
                report = await upstream(
                    "POST", f"/housing/{item['listing_id']}/payment-reports", owner, payload, platform=True
                )
            except HTTPException:
                item["payment_sync"] = "failed"
                continue
            if isinstance(report, dict) and report.get("id"):
                item["payment_report"] = report
                item.pop("payment_sync", None)
            else:
                item["payment_sync"] = "failed"
        return view

    @app.post("/web/api/threads/{thread}/viewings/{step}")
    async def viewing_step(
        thread: str,
        step: Literal[
            "unselect",
            "schedule",
            "cancel",
            "visit",
            "visit-review",
            "decide",
            "reopen",
            "paid",
            "moving-mode",
            "landlord-retry",
            "payment-retry",
        ],
        request: Request,
    ):
        owner, body = (actor(request) if step == "unselect" else user(request))["id"], await object_body(request)
        owned(thread, owner)
        if owner.startswith("guest_"):
            return await checkout_call("POST", f"/ui/chat/{thread}/viewings/unselect", owner, body)
        if step == "visit-review":
            from pydantic import ValidationError

            class ReviewedVisit(BaseModel):
                model_config = ConfigDict(extra="forbid")
                listing_id: str = Field(min_length=1, max_length=128)
                outcome: Literal["met_agreed", "met_rejected"]
                rating: int = Field(ge=1, le=5)
                body: str = Field(default="", max_length=2000)

            try:
                intent = ReviewedVisit.model_validate(body)
            except ValidationError:
                raise HTTPException(422, "Chọn kết quả buổi xem và đánh giá từ 1 đến 5 sao.") from None
            previous = await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner)
            if not isinstance(previous, dict):
                return previous
            prior = next(
                (
                    item
                    for item in [*previous.get("items", []), *previous.get("history", [])]
                    if item.get("listing_id") == intent.listing_id
                ),
                None,
            )
            review = {"rating": intent.rating, "body": intent.body.strip()}
            if (
                prior
                and prior.get("visit_review") == review
                and (prior.get("visit_outcome") or {}).get("outcome") == intent.outcome
            ):
                return await landlord_viewings(owner, previous, thread=thread, sync=True)
            await require_landlord_confirmation(thread, owner, intent.listing_id)
            slot = (prior.get("viewing") or {}).get("slot") if prior else None
            if (
                not prior
                or prior.get("status") not in {"visit_due", "viewing_scheduled", "visited", "backup"}
                or not slot
            ):
                raise HTTPException(409, "Cần có lịch hẹn hợp lệ trước khi đánh giá buổi xem.")
            try:
                due = datetime.fromisoformat(slot.replace("Z", "+00:00")).timestamp() <= time.time()
            except (ValueError, AttributeError):
                due = False
            if not due and not previous.get("test_visit_anytime"):
                raise HTTPException(409, "Chỉ ghi kết quả từ giờ hẹn xem trở đi.")
            page = await upstream("GET", "/housing/contact-requests/me", owner, platform=True)
            managed = (
                any(row.get("listing_id") == intent.listing_id for row in page.get("items", []))
                if isinstance(page, dict)
                else False
            )
            if managed:
                reviewed = await upstream(
                    "PUT", f"/housing/{intent.listing_id}/review", owner, {**review, "visit_slot": slot}, platform=True
                )
                if isinstance(reviewed, JSONResponse):
                    return reviewed
            result = await checkout_call(
                "POST",
                f"/ui/chat/{thread}/viewings/visit",
                owner,
                {"listing_id": intent.listing_id, "outcome": intent.outcome, "review": review},
            )
            return await landlord_viewings(owner, result, thread=thread, sync=True)
        if step == "visit":
            await require_landlord_confirmation(thread, owner, str(body.get("listing_id", "")))
        if step == "schedule":
            page = await upstream("GET", "/housing/contact-requests/me", owner, platform=True)
            if not isinstance(page, dict):
                raise HTTPException(503, "Chưa kiểm tra được giờ chủ nhà đề xuất.")
            row = next(
                (
                    row
                    for row in page.get("items", [])
                    if row.get("listing_id") == body.get("listing_id") and row.get("status") in OPEN_CONTACT
                ),
                None,
            )
            if (
                row
                and row.get("viewing_options")
                and not any(same_instant(option, body.get("slot")) for option in row["viewing_options"])
            ):
                raise HTTPException(409, "Hãy chọn một trong các giờ chủ nhà đề xuất.")
        if step == "decide":
            page = await upstream("GET", "/housing/contact-requests/me", owner, platform=True)
            if not isinstance(page, dict):
                raise HTTPException(503, "Chưa kiểm tra được lịch hẹn.")
            if any(row.get("listing_id") == body.get("listing_id") for row in page.get("items", [])):
                review_page = await upstream("GET", f"/housing/{body.get('listing_id')}/reviews", owner, platform=True)
                if not isinstance(review_page, dict):
                    return review_page
                mine = review_page.get("mine") or {}
                if not mine or mine.get("status") == "withdrawn":
                    raise HTTPException(409, "Hãy gửi đánh giá sau buổi xem trước khi chốt căn.")
        if step == "paid":
            previous = await landlord_viewings(
                owner, await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner), thread=thread
            )
            chosen = next(
                (item for item in previous.get("items", []) if item.get("status") in {"agreed", "reported_paid"}), None
            )
            if chosen:
                report = chosen.get("payment_report") or {}
                key = (chosen.get("reported_payment") or {}).get("report_key") or chosen.get("transaction_id")
                if report.get("status") in {"pending", "confirmed"}:
                    payment = chosen.get("reported_payment") or {}
                    if (
                        body.get("request_id") != key
                        or body.get("amount_vnd") != payment.get("amount_vnd")
                        or body.get("paid_on") != payment.get("paid_on")
                    ):
                        raise HTTPException(409, "Báo cáo chuyển tiền đang chờ hoặc đã được chủ nhà xác nhận.")
                    return previous
                await require_landlord_confirmation(thread, owner, chosen["listing_id"])
        if step == "reopen":
            # Never trust a client's claim that the landlord rejected a payment.
            body = {}
            previous = await landlord_viewings(
                owner, await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner), thread=thread
            )
            if not isinstance(previous, dict) or previous.get("landlord_unavailable"):
                raise HTTPException(503, "Chưa kiểm tra được phản hồi chuyển tiền của chủ nhà.")
            chosen = next((item for item in previous.get("items", []) if item.get("status") == "reported_paid"), None)
            if chosen:
                if (chosen.get("payment_report") or {}).get("status") != "rejected":
                    raise HTTPException(409, "Báo cáo chuyển tiền đang chờ hoặc đã được chủ nhà xác nhận.")
                body["rejected_report_key"] = (chosen.get("reported_payment") or {}).get("report_key") or chosen["transaction_id"]
        if step == "payment-retry":
            view = await landlord_viewings(
                owner, await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner), thread=thread
            )
            return await sync_reported_payments(owner, view)
        if step == "landlord-retry":
            # Tenant asks to resend times the landlord inbox has not received; nothing changes locally.
            result = await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner)
            return await landlord_viewings(owner, result, thread=thread, sync=True)
        result = await checkout_call("POST", f"/ui/chat/{thread}/viewings/{step}", owner, body)
        scheduled = str(body.get("listing_id", "")) if step == "schedule" else None
        view = await landlord_viewings(owner, result, thread=thread, scheduled=scheduled, sync=True)
        return await sync_reported_payments(owner, view) if step == "paid" else view

    async def require_landlord_confirmation(thread, owner, listing_id):
        """A home managed on ReloHome needs the landlord to confirm the booked time before the tenant
        records the visit (and so before deciding). Other homes keep the test-mode flow."""
        try:
            detail = await upstream("GET", f"/housing/{listing_id}", owner, platform=True)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise HTTPException(503, "Chưa kiểm tra được xác nhận của chủ nhà. Hãy thử lại.") from None
            detail = None  # Hidden managed homes still have private contact history.
        view = await landlord_viewings(
            owner, await checkout_call("GET", f"/ui/chat/{thread}/viewings", owner), thread=thread
        )
        item = (
            next((i for i in (view.get("items") or []) if i.get("listing_id") == listing_id), None)
            if isinstance(view, dict)
            else None
        )
        landlord = (item.get("landlord") or {}) if item else {}
        if not landlord and detail is None:
            raise HTTPException(409, "Chưa có lịch được chủ nhà xác nhận cho tin này.")
        if not landlord and not (isinstance(detail, dict) and detail.get("management")):
            if isinstance(view, dict) and view.get("landlord_unavailable"):
                raise HTTPException(503, "Chưa kiểm tra được xác nhận của chủ nhà. Hãy thử lại.")
            return
        if landlord.get("viewing_status") != "confirmed" or landlord.get("request_status") not in OPEN_CONTACT:
            raise HTTPException(409, "Chủ nhà chưa xác nhận giờ xem này; ghi kết quả sau khi chủ nhà xác nhận.")

    @app.post("/web/api/threads/{thread}/flight/outbound")
    async def flight_outbound(thread: str, request: Request):
        body = await object_body(request)
        request_id = body.pop("request_id", "")
        return await run(
            thread,
            actor(request)["id"],
            request_id,
            f"/ui/chat/{thread}/flight/outbound",
            body,
            "Chọn chuyến đi của vé khứ hồi",
            guest_peer=request.client.host if request.client else "unknown",
        )

    @app.get("/web/api/map/search")
    async def map_search(request: Request, text: str):
        return await upstream("GET", "/map/search?" + str(httpx.QueryParams({"text": text})), actor(request)["id"])

    @app.get("/web/api/housing/{listing_id}")
    async def detail(listing_id: str, request: Request):
        return await upstream("GET", f"/ui/housing/{listing_id}", actor(request)["id"])

    @app.get("/web/api/flight/{offer_id}")
    async def flight_detail(offer_id: str, request: Request):
        return await upstream("GET", f"/ui/flight/{offer_id}", actor(request)["id"])

    @app.get("/web/api/moving/services")
    async def moving_services(request: Request, lat: float, lng: float, refresh: bool = False):
        params = str(httpx.QueryParams({"lat": lat, "lng": lng, "refresh": refresh}))
        return await upstream("GET", "/ui/moving/services?" + params, actor(request)["id"])

    @app.post("/web/api/platform/{resource:path}")
    async def platform(resource: str, request: Request):
        if resource not in {"housing/map", "routes/entities", "routes/device", "housing/search", "places/map"}:
            raise HTTPException(404)
        return await upstream("POST", "/" + resource, actor(request)["id"], await object_body(request), platform=True)

    @app.post("/web/api/landlord/listings/{listing_id}/media-upload")
    async def housing_media_upload(listing_id: str, request: Request, alt: str | None = None):
        owner = user(request)["id"]
        if not re.fullmatch(r"[0-9a-f-]{36}", listing_id, re.IGNORECASE):
            raise HTTPException(404)
        too_large = HTTPException(413, "Ảnh phải là JPEG/PNG hợp lệ, tối đa 5 MB và 16 megapixel.")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
            raise too_large
        # Stop reading as soon as the limit is passed instead of buffering an unbounded body.
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_IMAGE_BYTES:
                raise too_large
        try:
            clean = await asyncio.to_thread(sanitized_image, bytes(body))
        except RoommateError as error:
            raise HTTPException(error.status, "Ảnh phải là JPEG/PNG hợp lệ, tối đa 5 MB và 16 megapixel.") from None
        media_dir = housing_media_dir()
        media_dir.mkdir(parents=True, exist_ok=True)
        identifier = secrets.token_hex(20)
        target = media_dir / f"{identifier}.png"
        await asyncio.to_thread(target.write_bytes, clean)
        # An empty value (as in the env template) means "not configured", like a missing one.
        public_base = (settings.siu_public_base_url or str(request.base_url)).rstrip("/")
        url = f"{public_base}/web/media/housing/{identifier}.png"
        digest = hashlib.sha256(clean).hexdigest()
        signature = hmac.new(
            settings.agent_api_token.get_secret_value().encode(),
            f"{listing_id}\n{url}\n{digest}".encode(),
            hashlib.sha256,
        ).hexdigest()
        try:
            result = await upstream(
                "POST",
                f"/landlord/listings/{listing_id}/media",
                owner,
                {"url": url, "content_sha256": digest, "alt": (alt or "").strip()[:300] or None},
                platform=True,
                extra_headers={"X-Housing-Media-Signature": signature},
            )
            if isinstance(result, JSONResponse):
                if result.status_code < 500:
                    target.unlink(missing_ok=True)
                return result
            if result.get("url") != url:
                target.unlink(missing_ok=True)
            return JSONResponse(result, status_code=201)
        except HTTPException as error:
            # A response can be lost after the descriptor commits. Keep the file for
            # digest-based retries; remove it only when the write definitively failed.
            if error.status_code < 500:
                target.unlink(missing_ok=True)
            raise

    @app.get("/web/media/housing/{filename}")
    async def housing_media(filename: str, request: Request):
        if not re.fullmatch(r"[0-9a-f]{40}\.png", filename):
            raise HTTPException(404)
        media_dir = housing_media_dir()
        target = (media_dir / filename).resolve()
        if not target.is_relative_to(media_dir.resolve()) or not target.is_file():
            raise HTTPException(404)
        row = app.state.store.session_user(request.cookies.get(COOKIE, ""))
        access = await upstream(
            "GET", f"/housing-media/{filename}/access", row["id"] if row else "__public_media__", platform=True
        )
        if isinstance(access, JSONResponse):
            return access
        if not isinstance(access, dict) or not isinstance(access.get("public"), bool):
            raise HTTPException(502, "Chưa kiểm tra được quyền truy cập ảnh.")
        return FileResponse(
            target,
            media_type="image/png",
            headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
        )

    @app.api_route("/web/api/housing-management/{resource:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def housing_management(resource: str, request: Request):
        if not any(pattern.fullmatch(resource) for pattern in HOUSING_MANAGEMENT_PATHS):
            raise HTTPException(404)
        row = user(request)
        expected = request.headers.get("x-siu-user")
        if expected and expected != row["id"]:
            raise HTTPException(409, "Phiên đăng nhập đã đổi tài khoản. Hãy tải lại trang trước khi tiếp tục.")
        if (
            resource.startswith("moderation/") or (resource == "housing/activity" and request.query_params.get("admin"))
        ) and row.get("workspace") != "admin":
            raise HTTPException(403, "Hãy đăng nhập khu Admin để kiểm duyệt.")
        if request.method == "POST" and (
            (resource.startswith("landlord/listings/") and resource.endswith("/media"))
            or resource.endswith("/documents")
        ):
            raise HTTPException(403, "Hãy dùng chức năng tải ảnh đã kiểm tra.")
        body = None if request.method == "GET" else await object_body(request)
        query = "?" + str(request.query_params) if request.method == "GET" and request.query_params else ""
        result = await upstream(request.method, "/" + resource + query, row["id"], body, platform=True)
        # Platform authorizes the conversation and derives its participants. Enrich
        # only that response with account names, without exposing a user directory.
        if request.method == "GET" and isinstance(result, dict):
            conversations = None
            if resource in {"housing/contact-notifications", "housing/activity"}:
                conversations = result.get("items", [])
            elif re.fullmatch(r"housing/contact-requests/[0-9a-fA-F-]+/messages", resource):
                conversations = [result]
            if isinstance(conversations, list):
                ids = list(
                    {
                        c.get("counterparty_user_id")
                        for c in conversations
                        if isinstance(c, dict) and isinstance(c.get("counterparty_user_id"), str)
                    }
                )
                names = {}
                if ids:
                    placeholders = ",".join("?" for _ in ids)
                    names = {
                        u["id"]: u["name"]
                        for u in app.state.store.all(
                            f"SELECT id,name FROM users WHERE id IN ({placeholders})", tuple(ids)
                        )
                    }
                destinations = {}
                for conversation in conversations:
                    if isinstance(conversation, dict):
                        conversation["counterparty_name"] = names.get(conversation.get("counterparty_user_id"))
                        if resource == "housing/activity" and conversation.get("audience") == "tenant":
                            listing = conversation.get("listing_id", "")
                            if listing not in destinations:
                                try:
                                    destinations[listing] = await upstream(
                                        "GET",
                                        "/ui/viewings/thread?" + str(httpx.QueryParams({"listing_id": listing})),
                                        row["id"],
                                    )
                                except HTTPException:
                                    destinations[listing] = {}
                            destination = destinations[listing]
                            if (
                                isinstance(destination, dict)
                                and destination.get("thread_id")
                                and app.state.store.one(
                                    "SELECT id FROM threads WHERE id=? AND owner=?",
                                    (destination["thread_id"], row["id"]),
                                )
                            ):
                                conversation["thread_id"] = destination["thread_id"]
        if isinstance(result, dict):
            # Public reviews carry their author's id only so the name can be shown;
            # replace it with the account name and never pass the id to the browser.
            if resource in {"landlord/reviews", "moderation/housing/reviews"} or re.fullmatch(
                r"housing/[0-9a-fA-F-]+/reviews?", resource
            ):
                reviews = [
                    r for r in [
                        *result.get("items", []), result.get("mine"),
                        result if resource.endswith("/review") else None,
                    ] if isinstance(r, dict)
                ]
                authors = list({r["author_user_id"] for r in reviews if isinstance(r.get("author_user_id"), str)})
                names = {}
                if authors:
                    placeholders = ",".join("?" for _ in authors)
                    names = {
                        u["id"]: u["name"]
                        for u in app.state.store.all(
                            f"SELECT id,name FROM users WHERE id IN ({placeholders})", tuple(authors)
                        )
                    }
                for review in reviews:
                    author = review.pop("author_user_id", None)
                    review["author_name"] = None if review.get("is_anonymous", True) else names.get(author)
        return result

    @app.get("/web/api/saved")
    async def saved(request: Request):
        principal = actor(request)
        if principal["id"].startswith("guest_"):
            return []
        return [
            {"id": r["id"], "thread_id": r["thread"], "house": json.loads(r["snapshot"])}
            for r in app.state.store.all("SELECT * FROM saved WHERE owner=?", (user(request)["id"],))
        ]

    @app.put("/web/api/saved/{listing_id}")
    async def save(listing_id: str, request: Request):
        body, owner = await object_body(request), user(request)["id"]
        thread = body.get("thread_id", "")
        owned(thread, owner)
        candidate = None
        for message in reversed(app.state.store.history(thread)):
            for component in (message["content"].get("ui") or {}).get("components", []):
                candidate = next(
                    (c for c in component.get("data", {}).get("candidates", []) if c.get("id") == listing_id), None
                )
                if candidate:
                    break
            if candidate:
                break
        if not candidate:
            # Listing explored on the map workspace: snapshot the provider record, never client data.
            candidate = await upstream("GET", f"/ui/housing/{listing_id}", owner)
            if not isinstance(candidate, dict) or candidate.get("id") != listing_id:
                raise HTTPException(404, "Không tìm thấy tin nhà.")
            candidate = {k: v for k, v in candidate.items() if k not in {"description", "images"}}
        app.state.store.write(
            "INSERT OR REPLACE INTO saved VALUES (?,?,?,?)", (owner, listing_id, thread, json.dumps(candidate))
        )
        return {"ok": True}

    @app.delete("/web/api/saved/{listing_id}")
    async def unsave(listing_id: str, request: Request):
        app.state.store.write("DELETE FROM saved WHERE owner=? AND id=?", (user(request)["id"], listing_id))
        return {"ok": True}

    attach_roommate_gateway(app, user, settings)

    @app.get("/{path:path}")
    async def static(path: str):
        if path.startswith("web/api"):
            raise HTTPException(404)
        dist = runtime_root() / "apps" / "web" / "dist"
        target = (dist / path).resolve()
        if target.is_relative_to(dist.resolve()) and target.is_file():
            return FileResponse(target)
        if (dist / "index.html").exists():
            return FileResponse(dist / "index.html")
        return JSONResponse(
            {"detail": "Chạy npm run build:web từ gốc repository, hoặc npm run dev để phát triển."}, status_code=503
        )

    return app


app = create_app()
