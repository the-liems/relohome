"""Private connection records. These are never public profile DTOs."""

from datetime import datetime
from typing import Annotated, Self

from pydantic import AfterValidator, Field, StrictBool, StrictInt, StringConstraints, model_validator

from src.roommate.clock import utc
from src.roommate.models import ProfileFacts, RoommateModel
from src.roommate.policy import GrantState, RequestState

UtcTimestamp = Annotated[datetime, AfterValidator(utc)]
Identifier = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=128)]


class IntroSnapshot(RoommateModel):
    display_name: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)]
    introduction: Annotated[str, StringConstraints(strict=True, max_length=1000)] | None = None
    facts: ProfileFacts
    reviewed_at: UtcTimestamp


class ContactRef(RoommateModel):
    channel_id: Identifier
    version: StrictInt = Field(ge=1)


class ContactConsent(RoommateModel):
    actor_id: Identifier
    recipient_id: Identifier
    contact: ContactRef
    confirmed: StrictBool
    confirmed_at: UtcTimestamp

    @model_validator(mode="after")
    def explicit_and_pair_specific(self) -> Self:
        if not self.confirmed or self.actor_id == self.recipient_id:
            raise ValueError("Explicit consent to a different recipient is required")
        return self


class RequestRecord(RoommateModel):
    id: Identifier
    sender_id: Identifier
    recipient_id: Identifier
    state: RequestState = RequestState.PENDING
    created_at: UtcTimestamp
    expires_at: UtcTimestamp
    intro: IntroSnapshot
    consent: ContactConsent
    closed_at: UtcTimestamp | None = None

    @model_validator(mode="after")
    def consistent_request(self) -> Self:
        if self.sender_id == self.recipient_id or self.expires_at <= self.created_at:
            raise ValueError("Invalid request pair or deadline")
        if self.consent.actor_id != self.sender_id or self.consent.recipient_id != self.recipient_id:
            raise ValueError("Consent must belong to the request pair")
        return self

    def effective_state(self, now: datetime) -> RequestState:
        if self.state is RequestState.PENDING and utc(now) >= self.expires_at:
            return RequestState.EXPIRED
        return self.state


class GrantRecord(RoommateModel):
    request_id: Identifier
    sender_id: Identifier
    recipient_id: Identifier
    state: GrantState = GrantState.ACTIVE
    accepted_at: UtcTimestamp
    expires_at: UtcTimestamp
    sender_contact: ContactRef
    recipient_contact: ContactRef

    @model_validator(mode="after")
    def consistent_grant(self) -> Self:
        if self.sender_id == self.recipient_id or self.expires_at <= self.accepted_at:
            raise ValueError("Invalid grant pair or deadline")
        return self

    def effective_state(self, now: datetime) -> GrantState:
        if self.state is GrantState.ACTIVE and utc(now) >= self.expires_at:
            return GrantState.EXPIRED
        return self.state
