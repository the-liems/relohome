"""Guest identity is issued by the trusted gateway, never by model or browser arguments."""

import re

from fastapi import HTTPException

READ_AGENTS = {"property", "flight", "map"}


def is_guest(owner):
    return bool(owner and re.fullmatch(r"guest_[0-9a-f]{32}", owner))


def require_account(owner):
    if is_guest(owner):
        raise HTTPException(401, "Đăng nhập để sử dụng chức năng này.")


def allowed(path, method):
    path = path.removeprefix("/api/v1")
    if method == "GET":
        return path in {"/status", "/map/search", "/ui/moving/services"} or bool(
            re.fullmatch(r"/chat/[^/]+/state|/ui/(?:housing|flight)/[^/]+|/ui/chat/[^/]+/(?:viewings|checkout)", path)
        )
    if method == "POST":
        return path in {"/chat", "/chat/guest-claim"} or bool(
            re.fullmatch(r"/ui/chat/[^/]+/(?:action|flight/outbound|viewings/unselect)", path)
        )
    return method == "DELETE" and bool(re.fullmatch(r"/chat/[^/]+", path))
