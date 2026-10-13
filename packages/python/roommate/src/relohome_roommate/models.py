"""Validated domain values; no persistence, I/O, recommendation or LLM calls."""

from datetime import date, time
from typing import Annotated, Generic, Self, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StringConstraints, model_validator

from relohome_roommate.policy import (
    City,
    Cleanliness,
    FeeBasis,
    Gender,
    MoveInKind,
    NeedKind,
    PreferenceStrength,
    SmokingHabit,
    SmokingTolerance,
    Sociability,
)

Value = TypeVar("Value")
AreaId = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)]


class RoommateModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Preference(RoommateModel, Generic[Value]):
    value: Value
    strength: PreferenceStrength = PreferenceStrength.SOFT


class AreaSelection(RoommateModel):
    area_ids: tuple[AreaId, ...] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def distinct_areas(self) -> Self:
        if len(set(self.area_ids)) != len(self.area_ids):
            raise ValueError("Area IDs must be distinct")
        return self


class BudgetRange(RoommateModel):
    """VND per person/month; a missing basis is not assumed to be rent-only."""

    min_vnd: StrictInt = Field(default=0, ge=0)
    max_vnd: StrictInt = Field(gt=0)
    fee_basis: FeeBasis | None = None

    @model_validator(mode="after")
    def ordered_bounds(self) -> Self:
        if self.min_vnd > self.max_vnd:
            raise ValueError("Minimum budget must not exceed maximum budget")
        return self


class HousingNeed(RoommateModel):
    kind: NeedKind
    willing_to_move: StrictBool | None = None

    @model_validator(mode="after")
    def room_specific_willingness(self) -> Self:
        if self.kind is NeedKind.LOOKING_TOGETHER and self.willing_to_move is not None:
            raise ValueError("Willingness to leave a room only applies when the person has a room")
        return self


class MoveInWindow(RoommateModel):
    kind: MoveInKind
    start: date | None = None
    end: date | None = None

    @model_validator(mode="after")
    def consistent_dates(self) -> Self:
        if self.kind is MoveInKind.FLEXIBLE:
            if self.start is not None or self.end is not None:
                raise ValueError("Flexible move-in must not contain dates")
        elif self.kind is MoveInKind.DATE:
            if self.start is None or self.end is not None:
                raise ValueError("An exact move-in date requires start only")
        elif self.start is None or self.end is None or self.start > self.end:
            raise ValueError("A move-in range requires ordered start and end dates")
        return self


class QuietHours(RoommateModel):
    """Minute-precision local interval, including intervals crossing midnight."""

    start: time
    end: time

    @model_validator(mode="after")
    def local_interval(self) -> Self:
        if self.start.tzinfo is not None or self.end.tzinfo is not None:
            raise ValueError("Quiet hours must be local times without timezone offsets")
        if any(value.second or value.microsecond for value in (self.start, self.end)):
            raise ValueError("Quiet hours require minute precision (HH:MM)")
        if self.start == self.end:
            raise ValueError("Quiet hours require different start and end times")
        return self


class SelfTraits(RoommateModel):
    gender: Gender | None = None
    smoking: SmokingHabit | None = None
    has_pets: StrictBool | None = None
    quiet_hours: QuietHours | None = None
    cleanliness: Cleanliness | None = None
    sociability: Sociability | None = None


class RoommatePreferences(RoommateModel):
    """Only a supplied preference applies; None is not permission or acceptance."""

    areas: Preference[AreaSelection] | None = None
    budget: Preference[BudgetRange] | None = None
    move_in: Preference[MoveInWindow] | None = None
    smoking: Preference[SmokingTolerance] | None = None
    pets_allowed: Preference[StrictBool] | None = None
    quiet_hours: Preference[QuietHours] | None = None
    cleanliness: Preference[Cleanliness] | None = None
    sociability: Preference[Sociability] | None = None
    gender: Preference[Gender] | None = None


class ProfileFacts(RoommateModel):
    """Self-declared target housing situation; missing fields remain unknown."""

    city: City | None = None
    area_ids: tuple[AreaId, ...] = Field(default=(), max_length=100)
    budget: BudgetRange | None = None
    need: HousingNeed | None = None
    move_in: MoveInWindow | None = None
    self_traits: SelfTraits = Field(default_factory=SelfTraits)

    @model_validator(mode="after")
    def consistent_area_scope(self) -> Self:
        if self.area_ids and self.city is None:
            raise ValueError("Area IDs require an explicitly declared city")
        if len(set(self.area_ids)) != len(self.area_ids):
            raise ValueError("Area IDs must be distinct")
        return self


class RoomPublication(RoommateModel):
    """Optional, explicit disclosure of a room; never inferred from chat or bookmarks."""

    listing_id: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=200)]
    public_location_consent: StrictBool

    @model_validator(mode="after")
    def explicit_consent(self) -> Self:
        if not self.public_location_consent:
            raise ValueError("Publishing a room requires explicit location consent")
        return self


class RoommateProfile(RoommateModel):
    """Draft-capable content, not a public DTO, ownership record or consent."""

    display_name: (
        Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)] | None
    ) = None
    introduction: (
        Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=1000)] | None
    ) = None
    facts: ProfileFacts = Field(default_factory=ProfileFacts)
    preferences: RoommatePreferences = Field(default_factory=RoommatePreferences)
    room: RoomPublication | None = None

    @model_validator(mode="after")
    def room_requires_having_room(self) -> Self:
        if self.room and (self.facts.need is None or self.facts.need.kind is not NeedKind.HAS_ROOM):
            raise ValueError("Only a has_room profile can publish a room on the map")
        return self


class RoommateSearchCriteria(RoommateModel):
    city: City
    self_facts: ProfileFacts = Field(default_factory=ProfileFacts)
    preferences: RoommatePreferences = Field(default_factory=RoommatePreferences)

    @model_validator(mode="after")
    def single_target_city(self) -> Self:
        if self.self_facts.city is not None and self.self_facts.city is not self.city:
            raise ValueError("Declared target housing city must match the search city")
        return self
