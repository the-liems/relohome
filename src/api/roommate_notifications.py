from fastapi import APIRouter, Query
from pydantic import Field
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_roommate.connections import Identifier
from relohome_roommate.models import RoommateModel
from relohome_roommate.services.notifications import NotificationService

router = APIRouter(prefix="/roommate", tags=["roommate"])


class ReadNotifications(RoommateModel):
    ids: list[Identifier] = Field(max_length=50)


@router.get("/notifications")
def notifications(actor: TrustedActor, ctx: Context, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50)):
    return perform(NotificationService(ctx).list, actor, offset, limit)


@router.post("/notifications/read")
def mark_read(body: ReadNotifications, actor: TrustedActor, ctx: Context):
    return perform(NotificationService(ctx).mark_read, actor, body.ids)


@router.post("/requests/{identifier}/read")
def read_request(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(NotificationService(ctx).read_request, actor, identifier)
