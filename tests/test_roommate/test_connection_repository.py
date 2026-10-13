from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from relohome_roommate.connection_repository import RepositoryPolicyError, SqlConnections
from relohome_roommate.connections import ContactConsent, ContactRef, IntroSnapshot, RequestRecord
from relohome_roommate.models import ProfileFacts
from relohome_roommate.policy import REQUEST_TTL
from relohome_roommate.storage import Storage

NOW = datetime(2026, 10, 7, tzinfo=UTC)


def item(sender="a", recipient="b", identifier="r1"):
    return RequestRecord(
        id=identifier,
        sender_id=sender,
        recipient_id=recipient,
        created_at=NOW,
        expires_at=NOW + REQUEST_TTL,
        intro=IntroSnapshot(display_name="Name", facts=ProfileFacts(), reviewed_at=NOW),
        consent=ContactConsent(
            actor_id=sender,
            recipient_id=recipient,
            contact=ContactRef(channel_id=sender, version=1),
            confirmed=True,
            confirmed_at=NOW,
        ),
    )


def test_two_connections_reverse_pair_race(tmp_path):
    path = tmp_path / "db"
    with Storage(path):
        pass
    barrier = Barrier(2)

    def send(sender, recipient, identifier):
        with Storage(path) as db:
            barrier.wait(timeout=5)
            with db.transaction():
                return SqlConnections(db.connection).create(item(sender, recipient, identifier), NOW).id

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(send, "a", "b", "r1")
        second = pool.submit(send, "b", "a", "r2")
        assert first.result(timeout=15) == second.result(timeout=15)
    with Storage(path) as db:
        assert db.connection.execute("SELECT COUNT(*) FROM requests").fetchone()[0] == 1


def test_idempotency_survives_restart_and_rejects_reuse(tmp_path):
    path = tmp_path / "db"
    with Storage(path) as db, db.transaction():
        repo = SqlConnections(db.connection)
        repo.finish_operation("a", "key", "fingerprint", {"request_id": "r1"})
    with Storage(path) as db:
        repo = SqlConnections(db.connection)
        assert repo.operation("a", "key", "fingerprint") == {"request_id": "r1"}
        assert repo.operation("b", "key", "different") is None
        with pytest.raises(RepositoryPolicyError, match="operation_conflict"):
            repo.operation("a", "key", "different")


def test_rolling_quota_atomic_and_no_withdraw_refund(tmp_path):
    with Storage(tmp_path / "db") as db, db.transaction():
        repo = SqlConnections(db.connection)
        for index in range(10):
            request = repo.create(item("a", f"b{index}", f"r{index}"), NOW)
            repo.close(request, "withdrawn", NOW)
        with pytest.raises(RepositoryPolicyError, match="daily_limit"):
            repo.create(item("a", "new", "rnew"), NOW)
        later = NOW + timedelta(hours=24)
        future = item("a", "new", "rnew").model_copy(update={"created_at": later, "expires_at": later + REQUEST_TTL})
        assert repo.create(future, later).id == "rnew"


def test_expiry_cooldown_from_deadline_not_reconciliation(tmp_path):
    with Storage(tmp_path / "db") as db, db.transaction():
        repo = SqlConnections(db.connection)
        repo.create(item(), NOW)
        deadline = NOW + REQUEST_TTL
        repo.expire(deadline + timedelta(days=1))
        assert repo.get("r1").state.value == "expired"
        assert repo.cooldown("a", "b") == deadline + timedelta(days=7)
        with pytest.raises(RepositoryPolicyError, match="cooldown"):
            repo.create(item(identifier="new"), deadline)
        assert repo.cooldown("b", "a") is None
