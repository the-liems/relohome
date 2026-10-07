from fastapi import APIRouter

from src.api.roommate_access import Context, TrustedActor, perform
from src.roommate.api_models import BookmarkInput, OwnProfileView, ProfileAction, ProfileUpdate
from src.roommate.models import RoommateProfile, RoommateSearchCriteria
from src.roommate.services.access import AccessService
from src.roommate.services.discovery import DiscoveryService
from src.roommate.services.profiles import ProfileService, validate_complete
from src.roommate.views import PublicProfile

router = APIRouter(prefix="/roommate", tags=["roommate"])


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
def update_profile(body: ProfileUpdate, actor: TrustedActor, ctx: Context):
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
def profile_action(body: ProfileAction, actor: TrustedActor, ctx: Context):
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
