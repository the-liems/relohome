from datetime import timedelta

from relohome_roommate.connections import ContactRef
from relohome_roommate.ports import Actor
from relohome_roommate.services.inbox import InboxService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_inbox_private_intro_deadline_and_block_status_only(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
        )
        service = InboxService(ctx)
        identifier = sent["request_id"]
        assert service.list(Actor(id="b"))["received_pending"] == 1
        detail = service.detail(Actor(id="b"), identifier)
        assert detail["intro"]["display_name"] == "Name"
        assert "consent" not in detail and "contact" not in str(detail)
        ctx.clock.advance(timedelta(days=7))
        assert service.list(Actor(id="b"))["received_pending"] == 0
        assert service.detail(Actor(id="b"), identifier)["state"] == "expired"
        with ctx.transaction():
            ctx.safety.block("a", "b", True)
        assert "intro" not in service.detail(Actor(id="b"), identifier)


def test_profile_expiry_reconciles_without_cron_and_reminder(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        service = InboxService(ctx)
        ctx.clock.advance(timedelta(days=27))
        assert service.list(Actor(id="a"))["profile_reminder"] is not None
        ctx.clock.advance(timedelta(days=3))
        assert service.list(Actor(id="a"))["profile_reminder"] is None
        assert ctx.profiles.get("a").state.value == "expired"
