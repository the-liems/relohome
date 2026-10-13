import pytest
from relohome_roommate.access import RoommateError
from relohome_roommate.connections import ContactRef
from relohome_roommate.ports import Actor
from relohome_roommate.services.moderation import ModerationService
from relohome_roommate.services.requests import RequestService
from relohome_roommate.services.safety import SafetyService
from relohome_roommate.storage import Storage

from tests.test_roommate.test_profile_lifecycle import complete
from tests.test_roommate.test_request_lifecycle import prepare


def test_block_cancels_pair_not_report_and_unblock_not_restore(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        request = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
        )
        service = SafetyService(ctx)
        service.report(Actor(id="b"), "a", "Reason", "report-operation-01")
        assert not ctx.safety.blocked("a", "b")
        assert ctx.connections.get(request["request_id"]).state.value == "pending"
        service.block(Actor(id="b"), "a", True, "block-operation-001")
        assert ctx.connections.get(request["request_id"]).state.value == "cancelled"
        service.block(Actor(id="b"), "a", False, "unblock-operation01")
        assert ctx.connections.get(request["request_id"]).state.value == "cancelled"


def test_moderation_is_server_authorized_and_scrubs_old_intro(tmp_path):
    with Storage(tmp_path / "db") as db:
        ctx = prepare(db)
        ctx.moderators = frozenset({"mod"})
        sent = RequestService(ctx).send(
            Actor(id="a"), "b", complete(), ContactRef(channel_id="a", version=1), True, "send-operation-001"
        )
        service = ModerationService(ctx)
        with pytest.raises(RoommateError, match="moderator_required"):
            service.reports(Actor(id="a"))
        service.restrict(Actor(id="mod"), "a", True, "Reviewed", "moderate-operation01")
        assert ctx.safety.restricted("a")
        assert ctx.connections.get(sent["request_id"]).intro.introduction is None
        service.restrict(Actor(id="mod"), "a", False, "Restored", "moderate-operation02")
        assert ctx.profiles.get("a").state.value == "paused"
        assert ctx.connections.get(sent["request_id"]).state.value == "cancelled"
