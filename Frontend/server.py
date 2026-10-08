"""SIU browser gateway. HttpOnly sessions; service secrets never reach JavaScript.

Run from repository root: python -m uvicorn Frontend.server:app --port 8503
The built Vite app is served here; development Vite proxies /web/api here.
"""

import asyncio
import hashlib
import io
import json
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from Frontend.roommate_gateway import attach_roommate_gateway
from Frontend.store import Store, password_hash
from src.agents.intake import redact_pii
from src.models.moving_options import MovingOptions
from src.models.schemas import MovingQuoteForm
from src.roommate.agent_projection import history_projection

ROOT = Path(__file__).resolve().parent
COOKIE = "siu_session"


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


def public_user(row):
    return {k: row[k] for k in ("id", "email", "name")} | {"preferences": json.loads(row["preferences"])}


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


def create_app(database=None, transport=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(database or os.getenv("SIU_WEB_DB", str(ROOT.parent / "data/siu-web.sqlite3")))
        app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(250, connect=10), transport=transport)
        app.state.locks = {}
        app.state.attempts = {}
        yield
        await app.state.http.aclose()
        app.state.store.db.close()

    app = FastAPI(title="SIU AI Web", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"detail": "Vui lòng kiểm tra các trường đã nhập."}, status_code=422)

    @app.middleware("http")
    async def browser_boundary(request, call_next):
        if request.url.path.startswith("/web/api") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if request.headers.get("x-siu-request") != "1" or (
                origin and urlsplit(origin).netloc != request.headers.get("host")
            ):
                return JSONResponse({"detail": "Phiên yêu cầu không hợp lệ. Hãy tải lại trang."}, status_code=403)
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

    async def upstream(method, path, owner, body=None, platform=False):
        base = (
            os.getenv("SIU_PLATFORM_API_URL", "http://127.0.0.1:4100/v1")
            if platform
            else os.getenv("LIFEFLOW_API_BASE_URL", "http://127.0.0.1:8000/api/v1")
        )
        token = os.getenv("AGENT_API_TOKEN", "")
        if not token and not platform:
            raise HTTPException(503, "Chưa kết nối được hệ thống AI. Vui lòng kiểm tra cấu hình máy chủ.")
        try:
            response = await app.state.http.request(
                method,
                base.rstrip("/") + path,
                headers={"Authorization": "Bearer " + token, "X-User-Id": owner},
                json=body,
            )
            data = response.json()
        except (httpx.RequestError, ValueError):
            raise HTTPException(
                502, "Chưa nhận được kết quả từ dịch vụ. Kiểm tra trạng thái trước khi gửi lại."
            ) from None
        if not response.is_success:
            detail = data.get("detail", data.get("message", "Dịch vụ chưa xử lý được yêu cầu."))
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

    @app.get("/web/api/session")
    async def session(request: Request):
        return public_user(user(request))

    @app.post("/web/api/auth/{action}")
    async def auth(action: Literal["login", "register"], body: Credentials, request: Request, response: Response):
        peer = request.client.host if request.client else "unknown"
        now = time.time()
        attempts = [x for x in app.state.attempts.get(peer, []) if x > now - 300]
        if len(attempts) >= 15:
            raise HTTPException(429, "Bạn đã thử nhiều lần. Vui lòng chờ vài phút.")
        app.state.attempts[peer] = [*attempts, now]
        email = body.email.strip().lower()
        store = app.state.store
        if action == "register":
            if os.getenv("SIU_ALLOW_REGISTRATION", "true").lower() != "true":
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
        token = store.create_session(row["id"])
        response.set_cookie(
            COOKIE,
            token,
            httponly=True,
            secure=os.getenv("SIU_SECURE_COOKIE", "false").lower() == "true",
            samesite="strict",
            max_age=86400 * 14,
            path="/",
        )
        return public_user(row)

    @app.post("/web/api/logout")
    async def logout(request: Request, response: Response):
        app.state.store.write(
            "DELETE FROM sessions WHERE token=?",
            (hashlib.sha256(request.cookies.get(COOKIE, "").encode()).hexdigest(),),
        )
        response.delete_cookie(COOKIE, path="/")
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
        return await upstream("GET", "/status", user(request)["id"])

    @app.get("/web/api/threads")
    async def threads(request: Request):
        return [
            {**r, "state": json.loads(r["state"])}
            for r in app.state.store.all(
                "SELECT id,title,updated,state,revision FROM threads WHERE owner=? ORDER BY updated DESC",
                (user(request)["id"],),
            )
        ]

    @app.post("/web/api/threads")
    async def new_thread(request: Request):
        owner, thread = user(request)["id"], "th_" + secrets.token_hex(16)
        app.state.store.write(
            "INSERT INTO threads(id,owner,title,updated) VALUES (?,?,?,?)",
            (thread, owner, "Cuộc trò chuyện mới", time.time()),
        )
        return snapshot(thread, owner)

    @app.get("/web/api/threads/{thread}")
    async def get_thread(thread: str, request: Request):
        owner = user(request)["id"]
        owned(thread, owner)
        await refresh(thread, owner)
        return snapshot(thread, owner)

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

    @app.delete("/web/api/threads/{thread}")
    async def delete_thread(thread: str, request: Request):
        await remove_thread(thread, user(request)["id"])
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

    async def run(thread, owner, request_id, path, body, label):
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
        return await run(
            thread,
            user(request)["id"],
            body.request_id,
            "/chat",
            {**body.model_dump(exclude={"request_id"}), "thread_id": thread},
            body.message,
        )

    @app.post("/web/api/threads/{thread}/action")
    async def action(thread: str, request: Request):
        body = await object_body(request)
        request_id = body.pop("request_id", "")
        if not isinstance(request_id, str) or not 16 <= len(request_id) <= 80:
            raise HTTPException(422, "Thiếu mã yêu cầu.")
        return await run(
            thread,
            user(request)["id"],
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

    @app.get("/web/api/map/search")
    async def map_search(request: Request, text: str):
        return await upstream("GET", "/map/search?" + str(httpx.QueryParams({"text": text})), user(request)["id"])

    @app.get("/web/api/housing/{listing_id}")
    async def detail(listing_id: str, request: Request):
        return await upstream("GET", f"/ui/housing/{listing_id}", user(request)["id"])

    @app.get("/web/api/flight/{offer_id}")
    async def flight_detail(offer_id: str, request: Request):
        return await upstream("GET", f"/ui/flight/{offer_id}", user(request)["id"])

    @app.get("/web/api/moving/services")
    async def moving_services(request: Request, lat: float, lng: float, refresh: bool = False):
        params = str(httpx.QueryParams({"lat": lat, "lng": lng, "refresh": refresh}))
        return await upstream("GET", "/ui/moving/services?" + params, user(request)["id"])

    @app.post("/web/api/platform/{resource:path}")
    async def platform(resource: str, request: Request):
        if resource not in {"housing/map", "routes/entities", "housing/search", "places/map"}:
            raise HTTPException(404)
        return await upstream("POST", "/" + resource, user(request)["id"], await object_body(request), platform=True)

    @app.get("/web/api/saved")
    async def saved(request: Request):
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

    attach_roommate_gateway(app, user)

    @app.get("/{path:path}")
    async def static(path: str):
        if path.startswith("web/api"):
            raise HTTPException(404)
        dist = ROOT / "dist"
        target = (dist / path).resolve()
        if target.is_relative_to(dist.resolve()) and target.is_file():
            return FileResponse(target)
        if (dist / "index.html").exists():
            return FileResponse(dist / "index.html")
        return JSONResponse(
            {"detail": "Chạy npm run build trong Frontend, hoặc npm run dev để phát triển."}, status_code=503
        )

    return app


app = create_app()
