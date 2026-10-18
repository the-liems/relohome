"""Whitelisted Roommate proxy; trusted identity only comes from the HttpOnly session."""

import json
import re

import httpx
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from relohome_gateway.settings import GatewaySettings

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
        r"moderation/(?:reports|summary|profiles)",
        rf"moderation/profiles/{IDENTIFIER}(?:/history)?",
        r"notifications",
        r"me/privacy(?:/export|/chat-messages)?",
        r"me/operation-drafts",
        rf"operation-drafts/{IDENTIFIER}",
        r"chat/conversations",
        rf"chat/conversations/{IDENTIFIER}/messages",
    ],
    "POST": [
        r"access",
        r"search",
        r"map/rooms",
        r"requests",
        r"reports",
        r"notifications/read",
        r"me/privacy/erase",
        r"me/profile/(?:preview|actions)",
        rf"requests/{IDENTIFIER}/(?:accept|reject|withdraw|revoke|read)",
        rf"moderation/profiles/{IDENTIFIER}",
        rf"moderation/reports/{IDENTIFIER}/resolve",
        r"chat/requests",
        rf"chat/requests/{IDENTIFIER}/accept",
        rf"chat/conversations/{IDENTIFIER}/(?:messages|read|close)",
    ],
    "PUT": [
        r"operation-drafts",
        r"me/(?:profile|intro|criteria|contacts)",
        rf"me/bookmarks/{IDENTIFIER}",
        rf"blocks/{IDENTIFIER}",
    ],
    "DELETE": [rf"media/{IDENTIFIER}", rf"operation-drafts/{IDENTIFIER}"],
}


def attach_roommate_gateway(app, user, settings: GatewaySettings) -> None:
    @app.api_route("/web/api/roommate/{resource:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def proxy(resource: str, request: Request):
        if not any(re.fullmatch(pattern, resource) for pattern in ROUTES.get(request.method, [])):
            raise HTTPException(404, {"code": "unknown_roommate_route"})
        query_routes = {
            "me/requests": {"offset", "limit", "direction"},
            "chat/conversations": {"offset", "limit"},
            "me/privacy/chat-messages": {"before", "limit"},
            "notifications": {"offset", "limit"},
            "moderation/reports": {"offset", "limit", "status"},
            "moderation/profiles": {
                "offset",
                "limit",
                "status",
                "q",
                "city",
                "need",
                "min_budget",
                "max_budget",
                "sort",
            },
        }
        if re.fullmatch(rf"chat/conversations/{IDENTIFIER}/messages", resource):
            query_routes[resource] = {"before", "limit"}
        if re.fullmatch(rf"moderation/profiles/{IDENTIFIER}/history", resource):
            query_routes[resource] = {"offset", "limit"}
        if request.query_params and (
            request.method != "GET"
            or resource not in query_routes
            or any(key not in query_routes[resource] for key in request.query_params)
            or len(request.query_params.multi_items()) != len(request.query_params)
        ):
            raise HTTPException(422, {"code": "unsupported_query"})
        public = request.method == "GET" and resource == "availability"
        owner = None if public else user(request)["id"]
        expected_actor = request.headers.get("X-Roommate-Actor")
        if not public and expected_actor and expected_actor != owner:
            raise HTTPException(409, {"code": "actor_changed"})
        token = settings.agent_api_token.get_secret_value()
        if not public and not token:
            raise HTTPException(503, {"code": "service_unavailable"})
        base = settings.lifeflow_api_base_url.rstrip("/")
        headers = {"Authorization": "Bearer " + token}
        if owner:
            headers["X-User-Id"] = owner
        kwargs = {"params": dict(request.query_params)} if request.query_params else {}
        if request.method in ("POST", "PUT") and not re.fullmatch(r"moderation/reports/[^/]+/resolve", resource):
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
