from fastapi import APIRouter
from pydantic import Field, StrictBool, StrictInt

from src.api.roommate_access import Context, TrustedActor, perform
from src.roommate.models import RoommateModel
from src.roommate.services.privacy import PrivacyService

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


@router.post("/me/privacy/erase")
def erase(body: ErasePrivateContent, actor: TrustedActor, ctx: Context):
    return perform(PrivacyService(ctx).erase, actor, body.confirmed, body.expected_version)
