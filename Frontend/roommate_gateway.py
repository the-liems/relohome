"""Whitelisted Roommate proxy; trusted identity only comes from the HttpOnly session."""

import json
import os
import re

import httpx
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from relohome_roommate.media import MAX_IMAGE_BYTES

IDENTIFIER = r"[A-Za-z0-9_.:-]{1,128}"
ROUTES = {
    "GET": [
        r"availability",
        r"access",
        r"me/(?:profile|intro|criteria|bookmarks|contacts|requests|blocks|media)",
        rf"profiles/{IDENTIFIER}",
        r"areas/(?:hcm|hanoi|danang)",
        rf"requests/{IDENTIFIER}(?:/contact)?",
        rf"operations/{IDENTIFIER}",
        rf"media/{IDENTIFIER}",
        r"moderation/(?:reports|media|summary|profiles)",
        r"notifications",
        r"me/privacy(?:/export)?",
        r"me/operation-drafts",
        rf"operation-drafts/{IDENTIFIER}",
    ],
    "POST": [
        r"access",
        r"search",
        r"demo/search",
        r"map/rooms",
        r"requests",
        r"reports",
        r"media",
        r"notifications/read",
        r"me/privacy/erase",
        r"me/profile/(?:preview|actions)",
        rf"requests/{IDENTIFIER}/(?:accept|reject|withdraw|revoke|read)",
        rf"moderation/profiles/{IDENTIFIER}",
        rf"moderation/reports/{IDENTIFIER}/resolve",
        rf"moderation/media/{IDENTIFIER}",
    ],
    "PUT": [
        r"operation-drafts",
        r"me/(?:profile|intro|criteria|contacts)",
        r"me/profile/avatar",
        rf"me/bookmarks/{IDENTIFIER}",
        rf"blocks/{IDENTIFIER}",
    ],
    "DELETE": [rf"media/{IDENTIFIER}", rf"operation-drafts/{IDENTIFIER}"],
}


def attach_roommate_gateway(app, user) -> None:
    @app.api_route("/web/api/roommate/{resource:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def proxy(resource: str, request: Request):
        if not any(re.fullmatch(pattern, resource) for pattern in ROUTES.get(request.method, [])):
            raise HTTPException(404, {"code": "unknown_roommate_route"})
        query_routes = {
            "me/requests": {"offset", "limit", "direction"},
            "notifications": {"offset", "limit"},
            "moderation/reports": {"offset", "limit", "status"},
            "moderation/media": {"offset", "limit", "status"},
            "moderation/profiles": {"offset", "limit", "status"},
        }
        if request.query_params and (
            request.method != "GET"
            or resource not in query_routes
            or any(key not in query_routes[resource] for key in request.query_params)
            or len(request.query_params.multi_items()) != len(request.query_params)
        ):
            raise HTTPException(422, {"code": "unsupported_query"})
        public = request.method == "GET" and resource == "availability"
        owner = None if public else user(request)["id"]
        token = os.getenv("AGENT_API_TOKEN", "")
        if not public and not token:
            raise HTTPException(503, {"code": "service_unavailable"})
        base = os.getenv("LIFEFLOW_API_BASE_URL", "http://127.0.0.1:8000/api/v1").rstrip("/")
        headers = {"Authorization": "Bearer " + token}
        if owner:
            headers["X-User-Id"] = owner
        kwargs = {"params": dict(request.query_params)} if request.query_params else {}
        if request.method == "POST" and resource == "media":
            key = request.headers.get("X-Roommate-Operation", "")
            if not 16 <= len(key) <= 128:
                raise HTTPException(422, {"code": "invalid_operation_key"})
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_IMAGE_BYTES:
                    raise HTTPException(413, {"code": "image_size_limit"})
                body.extend(chunk)
            headers.update({"X-Roommate-Operation": key, "Content-Type": "application/octet-stream"})
            kwargs["content"] = bytes(body)
        elif request.method in ("POST", "PUT") and not re.fullmatch(r"moderation/reports/[^/]+/resolve", resource):
            try:
                encoded = bytearray()
                async for chunk in request.stream():
                    if len(encoded) + len(chunk) > 64 * 1024:
                        raise HTTPException(413, {"code": "payload_too_large"})
                    encoded.extend(chunk)
                body = json.loads(encoded)
            except (ValueError, UnicodeDecodeError):
                raise HTTPException(422, {"code": "invalid_input"}) from None
            if not isinstance(body, dict):
                raise HTTPException(422, {"code": "invalid_input"})
            kwargs["json"] = body
        try:
            response = await app.state.http.request(
                request.method, base + "/roommate/" + resource, headers=headers, **kwargs
            )
        except httpx.RequestError:
            code = "operation_unknown" if request.method not in ("GET", "HEAD") else "service_unavailable"
            raise HTTPException(503, {"code": code}) from None
        if response.is_success and request.method == "GET" and resource.startswith("media/"):
            if response.headers.get("content-type", "").split(";", 1)[0] != "image/png":
                raise HTTPException(502, {"code": "invalid_upstream_response"})
            return Response(
                response.content,
                media_type="image/png",
                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
            )
        try:
            data = response.json()
        except ValueError:
            raise HTTPException(502, {"code": "invalid_upstream_response"}) from None
        return JSONResponse(data, status_code=response.status_code, headers={"Cache-Control": "no-store"})
