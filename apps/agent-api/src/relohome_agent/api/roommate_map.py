"""Public room markers from user-published profiles with explicit location consent."""

from typing import Annotated

from fastapi import APIRouter
from pydantic import Field, StrictBool, StringConstraints
from relohome_agent.api.roommate_access import Context, TrustedActor
from relohome_roommate.models import RoommateModel
from relohome_roommate.policy import ProfileState
from relohome_roommate.services.access import AccessService

router = APIRouter(prefix="/roommate", tags=["roommate"])


class MapRoomsInput(RoommateModel):
    listing_ids: tuple[Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)], ...] = Field(
        max_length=250
    )
    include_demo: StrictBool = Field(default=False, deprecated=True)  # Accepted but ignored for older clients.


@router.post("/map/rooms")
def map_rooms(body: MapRoomsInput, actor: TrustedActor, ctx: Context):
    ids, now = set(body.listing_ids), ctx.clock.now()
    items = []
    with ctx.read_transaction():
        # Viewing room-linked profiles still requires the existing Roommate opt-in.
        if AccessService(ctx).status(actor)["eligible"]:
            excluded = ctx.safety.discovery_exclusions(actor.id)
            # Discovery is for other people's posts. Keep the underlying housing
            # listing independent; manage one's own post through /me/profile.
            records = [
                p
                for p in ctx.profiles.active_rooms(ids, now)
                if p.owner_id != actor.id
                and p.owner_id not in excluded
                and p.state is ProfileState.ACTIVE
                and p.expires_at
                and now < p.expires_at
                and p.content.room
                and p.content.room.listing_id in ids
            ]
            items.extend(_marker(p) for p in records)
    return {"items": items, "demo_enabled": False}


def _marker(record):
    return {
        "listing_id": record.content.room.listing_id,
        "profile_id": record.owner_id,
        "display_name": record.content.display_name,
        "source_kind": "real",
        "label": "Đang tìm bạn trọ — thông tin tự khai; chưa xác minh quyền ở phòng",
        "connections_enabled": True,
    }
