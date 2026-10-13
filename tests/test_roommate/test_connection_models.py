from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from relohome_roommate.clock import FrozenClock, utc
from relohome_roommate.connections import ContactConsent, ContactRef, GrantRecord, IntroSnapshot, RequestRecord
from relohome_roommate.models import ProfileFacts
from relohome_roommate.policy import GRANT_TTL, PROFILE_TTL, REQUEST_TTL, GrantState, ProfileState, RequestState

NOW = datetime(2026, 10, 7, tzinfo=UTC)


def intro():
    return IntroSnapshot(display_name="Dung", facts=ProfileFacts(), reviewed_at=NOW)


def request():
    return RequestRecord(
        id="r1",
        sender_id="a",
        recipient_id="b",
        created_at=NOW,
        expires_at=NOW + REQUEST_TTL,
        intro=intro(),
        consent=ContactConsent(
            actor_id="a",
            recipient_id="b",
            contact=ContactRef(channel_id="c1", version=1),
            confirmed=True,
            confirmed_at=NOW,
        ),
    )


def test_utc_and_injectable_clock():
    assert utc(datetime(2026, 10, 7, 7, tzinfo=timezone(timedelta(hours=7)))) == NOW
    with pytest.raises(ValueError):
        utc(datetime(2026, 10, 7))
    clock = FrozenClock(NOW)
    assert clock.now() == NOW
    clock.advance(timedelta(seconds=1))
    assert clock.now() == NOW + timedelta(seconds=1)


def test_policy_durations_and_separate_states():
    assert PROFILE_TTL == timedelta(days=30)
    assert REQUEST_TTL == GRANT_TTL == timedelta(days=7)
    assert ProfileState.ACTIVE.value == "active"
    assert RequestState.ACCEPTED.value == "accepted"
    assert GrantState.REVOKED.value == "revoked"


def test_pending_expiry_exact_boundary():
    record = request()
    assert record.effective_state(record.expires_at - timedelta(microseconds=1)) is RequestState.PENDING
    assert record.effective_state(record.expires_at) is RequestState.EXPIRED
    accepted = record.model_copy(update={"state": RequestState.ACCEPTED})
    assert accepted.effective_state(NOW + timedelta(days=100)) is RequestState.ACCEPTED


def test_grant_has_independent_deadline_and_both_parties():
    grant = GrantRecord(
        request_id="r1",
        sender_id="a",
        recipient_id="b",
        accepted_at=NOW,
        expires_at=NOW + GRANT_TTL,
        sender_contact=ContactRef(channel_id="c1", version=1),
        recipient_contact=ContactRef(channel_id="c2", version=2),
    )
    assert grant.effective_state(NOW) is GrantState.ACTIVE
    assert grant.effective_state(grant.expires_at) is GrantState.EXPIRED
    assert grant.model_copy(update={"state": GrantState.REVOKED}).effective_state(NOW) is GrantState.REVOKED


@pytest.mark.parametrize("field,value", [("contact", "secret"), ("preferences", {}), ("phone", "secret")])
def test_intro_is_reviewed_whitelist(field, value):
    with pytest.raises(ValidationError):
        IntroSnapshot(**{**intro().model_dump(), field: value})


@pytest.mark.parametrize(
    "patch",
    [{"confirmed": False}, {"confirmed": "true"}, {"actor_id": "b"}, {"confirmed_at": NOW.replace(tzinfo=None)}],
)
def test_explicit_consent_required(patch):
    data = request().consent.model_dump()
    with pytest.raises(ValidationError):
        ContactConsent(**{**data, **patch})


@pytest.mark.parametrize(
    "patch", [{"recipient_id": "a"}, {"expires_at": NOW}, {"created_at": NOW.replace(tzinfo=None)}]
)
def test_invalid_request_rejected(patch):
    with pytest.raises(ValidationError):
        RequestRecord(**{**request().model_dump(), **patch})


def test_request_consent_must_match_parties():
    data = request().model_dump()
    data["consent"]["recipient_id"] = "c"
    with pytest.raises(ValidationError):
        RequestRecord(**data)


def test_intro_roundtrip_and_frozen():
    assert RequestRecord.model_validate_json(request().model_dump_json()) == request()
    with pytest.raises(ValidationError):
        intro().display_name = "Changed"
