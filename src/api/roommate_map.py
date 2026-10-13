"""Map opt-in and synthetic browsing; never creates connections or contacts."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field, StrictBool, StringConstraints

from src.api.roommate_access import Context, TrustedActor, perform
from src.roommate.api_models import SearchInput
from src.roommate.models import RoommateModel
from src.roommate.policy import ProfileState
from src.roommate.services.access import AccessService

router = APIRouter(prefix="/roommate", tags=["roommate"])


class MapRoomsInput(RoommateModel):
    listing_ids: tuple[Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)], ...] = Field(
        max_length=250
    )
    include_demo: StrictBool = False


@router.post("/demo/search")
def demo_search(body: SearchInput, actor: TrustedActor, ctx: Context, request: Request):
    demo = request.app.state.roommate_runtime.demo
    if demo is None:
        raise HTTPException(404, {"code": "demo_disabled"})
    perform(ctx.catalog.validate_criteria, body.criteria)
    return demo.search(actor.id, body.criteria, ctx.clock.now(), body.offset, body.limit)


@router.post("/map/rooms")
def map_rooms(body: MapRoomsInput, actor: TrustedActor, ctx: Context, request: Request):
    ids, now = set(body.listing_ids), ctx.clock.now()
    items = []
    with ctx.read_transaction():
        # Access opt-in is never granted by browsing the demo. Without it, only demo is visible.
        if AccessService(ctx).status(actor)["eligible"]:
            excluded = ctx.safety.discovery_exclusions(actor.id)
            records = [
                p
                for p in ctx.profiles.active_rooms(ids, now)
                if (p.owner_id == actor.id or p.owner_id not in excluded)
                and p.state is ProfileState.ACTIVE
                and p.expires_at
                and now < p.expires_at
                and p.content.room
                and p.content.room.listing_id in ids
            ]
            items.extend(_marker(p, "real") for p in records)
    demo = request.app.state.roommate_runtime.demo
    if body.include_demo and demo:
        items.extend(_marker(p, "demo") for p in demo.room_profiles(ids, now))
    return {"items": items, "demo_enabled": demo is not None}


def _marker(record, source):
    return {
        "listing_id": record.content.room.listing_id,
        "profile_id": record.owner_id,
        "display_name": record.content.display_name,
        "source_kind": source,
        "label": "DEMO — minh họa tìm bạn trọ, không xác nhận người ở đây"
        if source == "demo"
        else "Đang tìm bạn trọ — thông tin tự khai; chưa xác minh quyền ở phòng",
        "connections_enabled": source == "real",
    }
