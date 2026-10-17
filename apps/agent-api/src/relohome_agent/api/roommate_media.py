"""Read/delete legacy private photos; new uploads and moderation have been retired."""

from fastapi import APIRouter, Response
from relohome_agent.api.roommate_access import PRIVATE_HEADERS, Context, TrustedActor, perform
from relohome_roommate.media import MediaService

router = APIRouter(prefix="/roommate", tags=["roommate"])


@router.get("/me/media")
def own_media(actor: TrustedActor, ctx: Context):
    return {"items": perform(MediaService(ctx).own, actor)}


@router.get("/media/{identifier}")
def image(identifier: str, actor: TrustedActor, ctx: Context):
    body = perform(MediaService(ctx).read, actor, identifier)
    return Response(body, media_type="image/png", headers={**PRIVATE_HEADERS, "X-Content-Type-Options": "nosniff"})


@router.delete("/media/{identifier}")
def delete(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(MediaService(ctx).delete, actor, identifier)
