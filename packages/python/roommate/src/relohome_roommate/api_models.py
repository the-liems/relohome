from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, StringConstraints

from relohome_roommate.connections import ContactRef, Identifier, UtcTimestamp
from relohome_roommate.models import RoommateModel, RoommateProfile, RoommateSearchCriteria
from relohome_roommate.policy import ContactKind, ProfileState
from relohome_roommate.views import DiscoveryItem

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


class OperationInput(RoommateModel):
    operation_key: OperationKey


class SendInput(OperationInput):
    recipient_id: Identifier
    intro: RoommateProfile
    contact: ContactRef
    consent: StrictBool


class AcceptInput(OperationInput):
    contact: ContactRef
    consent: StrictBool


class ChatInviteInput(OperationInput):
    recipient_id: Identifier
    intro: RoommateProfile


class ChatMessageInput(RoommateModel):
    body: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2000)]
    client_message_id: OperationKey


class ChatReadInput(RoommateModel):
    message_id: Identifier


class ContactUpdate(OperationInput):
    kind: ContactKind
    value: Annotated[str, StringConstraints(strict=True, max_length=128)] | None
    expected_version: StrictInt | None = Field(default=None, ge=1)


class ContactView(RoommateModel):
    kind: ContactKind
    value: str


class ContactLeaseView(RoommateModel):
    request_id: Identifier
    expires_at: UtcTimestamp
    contact: ContactView


ReasonText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=1000)]


class BlockInput(OperationInput):
    selected: StrictBool


class ReportInput(OperationInput):
    profile_id: Identifier
    reason: ReasonText


class ModerationInput(BlockInput):
    reason: ReasonText
    expected_version: StrictInt | None = Field(default=None, ge=1)
