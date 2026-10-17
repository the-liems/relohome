from fastapi import APIRouter, Query
from pydantic import Field, StrictBool, StrictInt
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.models import RoommateModel
from relohome_roommate.services.privacy import PrivacyService

router = APIRouter(prefix="/roommate", tags=["roommate"])


class ErasePrivateContent(RoommateModel):
    confirmed: StrictBool
    expected_version: StrictInt | None = Field(default=None, ge=1)


@router.get("/me/privacy/export")
def export(actor: TrustedActor, ctx: Context):
    return perform(PrivacyService(ctx).export, actor)


@router.get("/me/privacy")
def status(actor: TrustedActor, ctx: Context):
    return perform(PrivacyService(ctx).status, actor)


@router.get("/me/privacy/chat-messages")
def chat_export(
    actor: TrustedActor,
    ctx: Context,
    before: str | None = Query(None, max_length=128),
    limit: int = Query(250, ge=1, le=500),
):
    return perform(PrivacyService(ctx).export_messages, actor, before=before, limit=limit)


@router.post("/me/privacy/erase")
def erase(body: ErasePrivateContent, actor: TrustedActor, ctx: Context):
    return perform(PrivacyService(ctx).erase, actor, body.confirmed, body.expected_version)
