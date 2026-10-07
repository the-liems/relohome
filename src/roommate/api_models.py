from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, StringConstraints

from src.roommate.connections import UtcTimestamp
from src.roommate.models import RoommateModel, RoommateProfile, RoommateSearchCriteria
from src.roommate.policy import ProfileState
from src.roommate.views import DiscoveryItem

OperationKey = Annotated[str, StringConstraints(strict=True, min_length=16, max_length=128)]


class AccessAcceptance(RoommateModel):
    adult: StrictBool
    terms_version: str


class SearchInput(RoommateModel):
    criteria: RoommateSearchCriteria
    offset: StrictInt = Field(default=0, ge=0)
    limit: StrictInt = Field(default=20, ge=1, le=50)


class DiscoveryPage(RoommateModel):
    items: tuple[DiscoveryItem, ...]
    total: int
    offset: int
    limit: int


class ProfileUpdate(RoommateModel):
    content: RoommateProfile
    expected_version: StrictInt | None = Field(default=None, ge=1)


class ProfileAction(RoommateModel):
    action: Literal["publish", "resume", "reconfirm", "pause", "resolve", "delete"]
    expected_version: StrictInt = Field(ge=1)
    reviewed: StrictBool = False


class OwnProfileView(RoommateModel):
    version: int
    state: ProfileState
    content: RoommateProfile
    expires_at: UtcTimestamp | None = None
    confirmed_at: UtcTimestamp | None = None
    avatar_id: str | None = None


class BookmarkInput(RoommateModel):
    selected: StrictBool
