import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import ValidationError
from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.api_models import AccessAcceptance
from relohome_roommate.connection_repository import RepositoryPolicyError
from relohome_roommate.policy import TERMS_VERSION, City
from relohome_roommate.ports import Actor
from relohome_roommate.profile_repository import VersionConflictError
from relohome_roommate.services.access import AccessService

PRIVATE_HEADERS = {"Cache-Control": "private, no-store", "Pragma": "no-cache"}
router = APIRouter(prefix="/roommate", tags=["roommate"])


def trusted_actor(
    request: Request, response: Response, authorization: str | None = Header(None), x_user_id: str | None = Header(None)
) -> Actor:
    response.headers.update(PRIVATE_HEADERS)
    runtime = getattr(request.app.state, "roommate_runtime", None)
    if runtime is None:
        raise HTTPException(503, {"code": "service_unavailable"}, headers=PRIVATE_HEADERS)
    if not authorization or not secrets.compare_digest(authorization, "Bearer " + runtime.token):
        raise HTTPException(401, {"code": "authentication_required"}, headers=PRIVATE_HEADERS)
    try:
        actor = Actor(id=x_user_id)
    except ValidationError:
        raise HTTPException(401, {"code": "authentication_required"}, headers=PRIVATE_HEADERS) from None
    from relohome_roommate.services.resources import take_budget

    resource = request.url.path.rsplit("/", 1)[-1]
    budget = (
        "chat_message"
        if request.method == "POST" and resource == "messages" and "/roommate/chat/" in request.url.path
        else "search"
        if resource in ("search", "rooms")
        else "upload"
        if request.method == "POST" and resource == "media"
        else "report"
        if resource == "reports" and request.method == "POST"
        else "read"
        if request.method == "GET"
        else "write"
    )
    limits = {"search": 60, "upload": 12, "report": 10, "read": 240, "write": 120, "chat_message": 20}
    with runtime.context() as ctx:
        perform(take_budget, ctx, actor, budget, limit=limits[budget])
    return actor


TrustedActor = Annotated[Actor, Depends(trusted_actor)]


def context(request: Request, actor: TrustedActor):
    with request.app.state.roommate_runtime.context() as ctx:
        yield ctx


Context = Annotated[RoommateContext, Depends(context)]


def perform(action, *args, **kwargs):
    try:
        return action(*args, **kwargs)
    except RoommateError as error:
        detail = {"code": error.code}
        if error.until:
            detail["retry_at"] = error.until.isoformat()
        if error.reasons:
            detail["reasons"] = list(error.reasons)
        raise HTTPException(error.status, detail, headers=PRIVATE_HEADERS) from None
    except RepositoryPolicyError as error:
        detail = {"code": error.code}
        if error.until:
            detail["retry_at"] = error.until.isoformat()
        raise HTTPException(429 if "limit" in error.code else 409, detail, headers=PRIVATE_HEADERS) from None
    except VersionConflictError:
        raise HTTPException(409, {"code": "version_conflict"}, headers=PRIVATE_HEADERS) from None
    except ValueError:
        raise HTTPException(422, {"code": "invalid_input"}, headers=PRIVATE_HEADERS) from None


@router.get("/availability")
def availability(request: Request):
    return {
        "enabled": getattr(request.app.state, "roommate_runtime", None) is not None,
        "cities": [city.value for city in City],
        "terms_version": TERMS_VERSION,
        "demo_enabled": False,  # Compatibility for older clients; synthetic discovery has been retired.
        "features": ["notifications", "moderation", "privacy", "operation_drafts", "chat"],
    }


@router.get("/access")
def access(actor: TrustedActor, ctx: Context):
    return AccessService(ctx).status(actor)


@router.post("/access")
def accept_access(body: AccessAcceptance, actor: TrustedActor, ctx: Context):
    return perform(AccessService(ctx).accept, actor, body.adult, body.terms_version)
