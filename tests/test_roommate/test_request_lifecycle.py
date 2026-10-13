from datetime import UTC, datetime

import pytest
from relohome_roommate.access import RoommateContext, RoommateError
from relohome_roommate.clock import FrozenClock
from relohome_roommate.connections import ContactRef
from relohome_roommate.policy import TERMS_VERSION
from relohome_roommate.ports import Actor
from relohome_roommate.services.access import AccessService
from relohome_roommate.services.profiles import ProfileService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete


def prepare(db):
    ctx = RoommateContext(db, clock=FrozenClock(datetime(2026, 10, 7, tzinfo=UTC)))
    for identifier in ("a", "b"):
        actor = Actor(id=identifier)
        AccessService(ctx).accept(actor, True, TERMS_VERSION)
        draft = ProfileService(ctx).save(actor, complete(), None)
        ProfileService(ctx).transition(actor, "publish", draft.version, True)
        with ctx.transaction():
            db.connection.execute(
                "INSERT INTO contacts VALUES (?,?,?,1,?)", (identifier, identifier, "phone", b"encrypted")
            )
    return ctx


def test_send_retry_reverse_and_withdraw_role(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        service = RequestService(ctx)
        a, b = Actor(id="a"), Actor(id="b")
        key = "send-operation-0001"
        result = service.send(a, "b", complete(), ContactRef(channel_id="a", version=1), True, key)
        assert service.send(a, "b", complete(), ContactRef(channel_id="a", version=1), True, key) == result
        reverse = service.send(b, "a", complete(), ContactRef(channel_id="b", version=1), True, "send-operation-0002")
        assert reverse["request_id"] == result["request_id"] and reverse["direction"] == "received"
        assert ctx.connections.counts("a", ctx.clock.now())[0] == 1
        with pytest.raises(RoommateError, match="action_not_allowed"):
            service.close(b, result["request_id"], "withdraw", "close-operation-01")
        service.close(a, result["request_id"], "withdraw", "close-operation-01")
        assert ctx.connections.get(result["request_id"]).state.value == "withdrawn"
        with pytest.raises(ValueError, match="cooldown"):
            service.send(a, "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-0003")


@pytest.mark.parametrize("consent,version,error", [(False, 1, "consent_required"), (True, 2, "contact_changed")])
def test_send_validates_explicit_consent_and_current_contact(tmp_path, consent, version, error):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        with pytest.raises(RoommateError, match=error):
            RequestService(ctx).send(
                Actor(id="a"),
                "b",
                complete(),
                ContactRef(channel_id="a", version=version),
                consent,
                "send-operation-0001",
            )
        assert ctx.connections.counts("a", ctx.clock.now()) == (0, 0)
