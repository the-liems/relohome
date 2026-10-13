from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import Field, StrictBool
from relohome_agent.api.roommate_access import PRIVATE_HEADERS, Context, TrustedActor, perform
from relohome_roommate.api_models import ReasonText
from relohome_roommate.media import MAX_IMAGE_BYTES, MediaService
from relohome_roommate.models import RoommateModel
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/roommate", tags=["roommate"])


@router.get("/me/media")
def own_media(actor: TrustedActor, ctx: Context):
    return {"items": perform(MediaService(ctx).own, actor)}


class ImageReview(RoommateModel):
    approved: StrictBool
    reason: ReasonText


class AvatarInput(RoommateModel):
    media_id: str = Field(min_length=1, max_length=128)
    expected_version: int = Field(ge=1)


@router.post("/media")
async def upload(request: Request, actor: TrustedActor, ctx: Context, x_roommate_operation: str = Header()):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_IMAGE_BYTES:
            raise HTTPException(413, {"code": "image_size_limit"}, headers=PRIVATE_HEADERS)
        body.extend(chunk)
    return await run_in_threadpool(perform, MediaService(ctx).upload, actor, bytes(body), x_roommate_operation)


@router.get("/media/{identifier}")
def image(identifier: str, actor: TrustedActor, ctx: Context):
    body = perform(MediaService(ctx).read, actor, identifier)
    return Response(body, media_type="image/png", headers={**PRIVATE_HEADERS, "X-Content-Type-Options": "nosniff"})


@router.delete("/media/{identifier}")
def delete(identifier: str, actor: TrustedActor, ctx: Context):
    return perform(MediaService(ctx).delete, actor, identifier)


@router.post("/moderation/media/{identifier}")
def review(identifier: str, body: ImageReview, actor: TrustedActor, ctx: Context):
    return perform(MediaService(ctx).review, actor, identifier, body.approved, body.reason)


@router.get("/moderation/media")
def queue(
    actor: TrustedActor,
    ctx: Context,
    offset: int | None = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=50),
    status: str | None = None,
):
    from relohome_roommate.services.moderation import ModerationService

    if offset is None and status is None:
        return {"items": perform(MediaService(ctx).queue, actor)}
    return perform(ModerationService(ctx).queue, actor, "media", status=status, offset=offset or 0, limit=limit)


@router.put("/me/profile/avatar")
def avatar(body: AvatarInput, actor: TrustedActor, ctx: Context):
    return perform(MediaService(ctx).attach, actor, body.media_id, body.expected_version)
