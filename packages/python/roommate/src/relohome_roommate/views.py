"""Explicit whitelisted projections; never serialize repository records to clients."""

from relohome_roommate.connections import Identifier
from relohome_roommate.models import ProfileFacts, RoommateModel, RoommateProfile
from relohome_roommate.policy import ProfileState
from relohome_roommate.ports import Actor, ProfileRecord


class PublicProfile(RoommateModel):
    profile_id: Identifier
    display_name: str | None
    introduction: str | None
    facts: ProfileFacts
    avatar_id: Identifier | None = None


class UnavailableProfile(RoommateModel):
    profile_id: Identifier
    available: bool = False


class OwnerProfile(RoommateModel):
    version: int
    state: ProfileState
    content: RoommateProfile


class PublishedCompatibility(RoommateModel):
    score: int | None = None
    label: str | None = None
    positives: tuple[str, ...] = ()
    differences: tuple[str, ...] = ()
    missing: tuple[str, ...] = ()


class DiscoveryItem(RoommateModel):
    profile: PublicProfile
    compatibility: PublishedCompatibility


def public_profile(record: ProfileRecord) -> PublicProfile:
    # Callers must enforce current expiry, viewer eligibility and block before this projection.
    if record.state is not ProfileState.ACTIVE:
        raise PermissionError("Profile unavailable")
    return PublicProfile(
        profile_id=record.owner_id,
        display_name=record.content.display_name,
        introduction=record.content.introduction,
        facts=record.content.facts,
        avatar_id=record.avatar_id,
    )


def unavailable_profile(profile_id: str) -> UnavailableProfile:
    return UnavailableProfile(profile_id=profile_id)


def owner_profile(record: ProfileRecord, actor: Actor) -> OwnerProfile:
    if actor.id != record.owner_id:
        raise PermissionError("Owner access required")
    return OwnerProfile(version=record.version, state=record.state, content=record.content)
