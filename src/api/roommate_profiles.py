from fastapi import APIRouter, HTTPException, Request
from relohome_agent.api.roommate_access import Context, TrustedActor, perform
from relohome_agent.api.web_actions import explored_listing
from relohome_roommate.api_models import BookmarkInput, OwnProfileView, ProfileAction, ProfileUpdate
from relohome_roommate.location_catalog import listing_city
from relohome_roommate.models import RoommateProfile, RoommateSearchCriteria
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.discovery import DiscoveryService
from relohome_roommate.services.profiles import ProfileService, validate_complete
from relohome_roommate.views import PublicProfile

router = APIRouter(prefix="/roommate", tags=["roommate"])


async def validate_room(content: RoommateProfile, request: Request):
    if not content.room:
        return
    service = getattr(request.app.state, "agent_service", None)
    if service is None:
        raise HTTPException(503, {"code": "service_unavailable"})
    listing = await explored_listing(service, content.room.listing_id)
    if listing is None:
        raise HTTPException(422, {"code": "room_listing_unavailable"})
    known_city = listing_city(listing.get("city"))
    if content.facts.city and known_city and known_city != content.facts.city:
        raise HTTPException(422, {"code": "room_city_mismatch"})


def own_view(record):
    return OwnProfileView(
        version=record.version,
        state=record.state,
        content=record.content,
        expires_at=record.expires_at,
        confirmed_at=record.confirmed_at,
        avatar_id=record.avatar_id,
    )


@router.get("/me/profile", response_model=OwnProfileView | None)
def own_profile(actor: TrustedActor, ctx: Context):
    perform(AccessService(ctx).require, actor)
    record = ctx.profiles.get(actor.id)
    return own_view(record) if record else None


@router.put("/me/profile", response_model=OwnProfileView)
async def update_profile(body: ProfileUpdate, actor: TrustedActor, ctx: Context, request: Request):
    perform(AccessService(ctx).require, actor)
    await validate_room(body.content, request)
    return own_view(perform(ProfileService(ctx).save, actor, body.content, body.expected_version))


@router.post("/me/profile/preview", response_model=PublicProfile)
def preview(body: RoommateProfile, actor: TrustedActor, ctx: Context):
    perform(AccessService(ctx).require, actor)
    perform(validate_complete, body)
    perform(ctx.catalog.validate_profile, body)
    return PublicProfile(
        profile_id=actor.id, display_name=body.display_name, introduction=body.introduction, facts=body.facts
    )


@router.post("/me/profile/actions", response_model=OwnProfileView)
async def profile_action(body: ProfileAction, actor: TrustedActor, ctx: Context, request: Request):
    perform(AccessService(ctx).require, actor)
    record = ctx.profiles.get(actor.id)
    if record and body.action in ("publish", "resume", "reconfirm"):
        await validate_room(record.content, request)
    return own_view(perform(ProfileService(ctx).transition, actor, body.action, body.expected_version, body.reviewed))


@router.get("/me/intro", response_model=RoommateProfile | None)
def intro(actor: TrustedActor, ctx: Context):
    perform(AccessService(ctx).require, actor)
    return ctx.profiles.intro(actor.id)


@router.put("/me/intro")
def update_intro(body: RoommateProfile, actor: TrustedActor, ctx: Context):
    perform(ProfileService(ctx).save_intro, actor, body)
    return {"saved": True}


@router.get("/me/criteria", response_model=RoommateSearchCriteria | None)
def criteria(actor: TrustedActor, ctx: Context):
    perform(AccessService(ctx).require, actor)
    return ctx.profiles.criteria(actor.id)


@router.put("/me/criteria")
def update_criteria(body: RoommateSearchCriteria, actor: TrustedActor, ctx: Context):
    perform(DiscoveryService(ctx).save_criteria, actor, body)
    return {"saved": True}


@router.get("/me/bookmarks")
def bookmarks(actor: TrustedActor, ctx: Context):
    return {"items": perform(DiscoveryService(ctx).saved, actor)}


@router.put("/me/bookmarks/{identifier}")
def bookmark(identifier: str, body: BookmarkInput, actor: TrustedActor, ctx: Context):
    return perform(DiscoveryService(ctx).bookmark, actor, identifier, body.selected)
