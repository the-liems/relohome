"""Trusted domain identity and transactional boundaries, independent of Agent state."""

from collections.abc import Iterable
from contextlib import AbstractContextManager
from typing import Protocol, Self

from pydantic import Field, model_validator

from relohome_roommate.connections import Identifier, RequestRecord, UtcTimestamp
from relohome_roommate.models import RoommateModel, RoommateProfile
from relohome_roommate.policy import ProfileState


class Actor(RoommateModel):
    id: Identifier

    @model_validator(mode="after")
    def identified(self) -> Self:
        if self.id == "anonymous" or self.id.startswith("demo_"):
            raise ValueError("A trusted authenticated actor is required")
        return self


class ProfileRecord(RoommateModel):
    owner_id: Identifier
    version: int = Field(ge=1)
    state: ProfileState = ProfileState.DRAFT
    content: RoommateProfile
    updated_at: UtcTimestamp
    confirmed_at: UtcTimestamp | None = None
    expires_at: UtcTimestamp | None = None
    avatar_id: Identifier | None = None

    @model_validator(mode="after")
    def publication_deadline(self) -> Self:
        if self.state is ProfileState.ACTIVE and (self.confirmed_at is None or self.expires_at is None):
            raise ValueError("Active profiles require explicit reconfirmation and expiry")
        if self.confirmed_at and self.expires_at and self.expires_at <= self.confirmed_at:
            raise ValueError("Profile expiry must follow reconfirmation")
        return self


class ProfileRepository(Protocol):
    def get(self, owner_id: str) -> ProfileRecord | None: ...
    def save(self, record: ProfileRecord, expected_version: int | None) -> None: ...
    def all(self) -> Iterable[ProfileRecord]: ...


class ConnectionRepository(Protocol):
    def get(self, request_id: str) -> RequestRecord | None: ...
    def save(self, record: RequestRecord) -> None: ...


class SafetyRepository(Protocol):
    def blocked(self, first: str, second: str) -> bool: ...
    def restricted(self, actor_id: str) -> bool: ...


class UnitOfWork(Protocol):
    profiles: ProfileRepository
    connections: ConnectionRepository
    safety: SafetyRepository

    def transaction(self) -> AbstractContextManager[Self]: ...
