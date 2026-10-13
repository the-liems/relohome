from relohome_roommate.connections import ContactRef
from relohome_roommate.ports import Actor
from relohome_roommate.services.consent import ConsentService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_erasure_removes_private_content_preserves_quota_and_closes_consent(tmp_path):
    from relohome_roommate.services.privacy import PrivacyService

    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "privacy-send-0001"
        )
        ConsentService(ctx).accept(
            Actor(id="b"), sent["request_id"], ContactRef(channel_id="b", version=1), True, "privacy-accept-001"
        )
        version = ctx.profiles.get("a").version
        PrivacyService(ctx).erase(Actor(id="a"), True, version)
        assert ctx.profiles.get("a").state.value == "deleted"
        assert ctx.profiles.get("a").content.display_name is None
        assert ctx.connections.grant(sent["request_id"]).state.value == "revoked"
        assert ctx.connections.counts("a", ctx.clock.now())[0] == 1
        assert ctx.connections.get(sent["request_id"]).intro.display_name == "Unavailable"
        assert db.connection.execute("SELECT ciphertext FROM contacts WHERE owner='a'").fetchone()[0] is None
        assert ctx.profiles.get("b").content.display_name == "Name"
