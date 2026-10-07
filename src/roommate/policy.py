"""Roommate vocabulary; independent of existing service contracts."""

from enum import StrEnum


class City(StrEnum):
    HCM = "hcm"
    HANOI = "hanoi"
    DANANG = "danang"


class PreferenceStrength(StrEnum):
    SOFT = "soft"
    HARD = "hard"


class NeedKind(StrEnum):
    HAS_ROOM = "has_room"
    LOOKING_TOGETHER = "looking_together"


class FeeBasis(StrEnum):
    RENT_ONLY = "rent_only"
    INCLUDING_FEES = "including_fees"


class MoveInKind(StrEnum):
    DATE = "date"
    RANGE = "range"
    FLEXIBLE = "flexible"


class Gender(StrEnum):
    FEMALE = "female"
    MALE = "male"
    NON_BINARY = "non_binary"
    OTHER = "other"


class SmokingHabit(StrEnum):
    NON_SMOKER = "non_smoker"
    OUTDOORS_ONLY = "outdoors_only"
    INDOORS = "indoors"


class SmokingTolerance(StrEnum):
    NO_SMOKING = "no_smoking"
    OUTDOORS_ONLY = "outdoors_only"
    INDOORS_ALLOWED = "indoors_allowed"


class Cleanliness(StrEnum):
    DAILY = "daily"
    SEVERAL_TIMES_WEEK = "several_times_week"
    WEEKLY = "weekly"


class Sociability(StrEnum):
    MOSTLY_PRIVATE = "mostly_private"
    BALANCED = "balanced"
    OFTEN_SHARED = "often_shared"
