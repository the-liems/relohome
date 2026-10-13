from fastapi import APIRouter
from pydantic import Field
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.models import RoommateModel
from relohome_roommate.services.operation_drafts import OperationDraftService

router = APIRouter(prefix="/roommate", tags=["roommate"])


class DraftInput(RoommateModel):
    path: str = Field(min_length=1, max_length=200)
    method: str = Field(min_length=3, max_length=6)
    body: dict


@router.put("/operation-drafts")
def save(body: DraftInput, actor: TrustedActor, ctx: Context):
    return perform(OperationDraftService(ctx).save, actor, body.path, body.method, body.body)


@router.get("/me/operation-drafts")
def drafts(actor: TrustedActor, ctx: Context):
    return perform(OperationDraftService(ctx).list, actor)


@router.get("/operation-drafts/{key}")
def get(key: str, actor: TrustedActor, ctx: Context):
    return perform(OperationDraftService(ctx).get, actor, key)


@router.delete("/operation-drafts/{key}")
def discard(key: str, actor: TrustedActor, ctx: Context):
    return perform(OperationDraftService(ctx).discard, actor, key)
