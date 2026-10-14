"""Explicit public operations; POST searches are reads, while contact/payment operations are private."""

import re


def allowed(path, method):
    path = path.removeprefix("/web/api")
    if path in {"/session", "/logout"} or path.startswith("/auth/"):
        return True
    if method == "GET":
        return (
            path in {"/status", "/threads", "/saved", "/map/search", "/moving/services"}
            or bool(re.fullmatch(r"/(?:housing|flight)/[^/]+|/threads/[^/]+(?:/viewings|/checkout)?", path))
            or path == "/roommate/availability"
        )
    if method == "DELETE":
        return bool(re.fullmatch(r"/threads/[^/]+", path))
    if method == "POST":
        return (
            path == "/threads"
            or bool(re.fullmatch(r"/threads/[^/]+/(?:chat|action|flight/outbound|viewings/unselect)", path))
            or path
            in {
                "/platform/housing/map",
                "/platform/housing/search",
                "/platform/places/map",
                "/platform/routes/entities",
                "/platform/routes/device",
            }
        )
    return False
