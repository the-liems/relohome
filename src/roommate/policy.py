"""Roommate vocabulary; independent of existing service contracts."""

from datetime import timedelta
from enum import StrEnum

PROFILE_TTL = timedelta(days=30)
REQUEST_TTL = timedelta(days=7)
GRANT_TTL = timedelta(days=7)
REJECT_COOLDOWN = timedelta(days=30)
WITHDRAW_COOLDOWN = timedelta(hours=24)
EXPIRED_COOLDOWN = timedelta(days=7)
REVOKE_COOLDOWN = timedelta(days=30)
REQUEST_WINDOW = timedelta(hours=24)
MAX_REQUESTS_PER_WINDOW = 10
MAX_PENDING = 20
TERMS_VERSION = "roommate-1.0"


class ProfileState(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    RESOLVED = "resolved"
    EXPIRED = "expired"
    RESTRICTED = "restricted"
    DELETED = "deleted"


class RequestState(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class GrantState(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"


class ContactKind(StrEnum):
    PHONE = "phone"
    ZALO = "zalo"


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
