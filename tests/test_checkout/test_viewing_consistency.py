"""State invariants against real SQLite/store/service; no mocked providers or catalog data."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from relohome_agent.checkout.models import CheckoutError, ServiceTransaction
from relohome_agent.checkout.store import CheckoutStore
from relohome_agent.checkout.viewing import ViewingService, ViewingSettings
from relohome_agent.config import Settings


def service_and_records():
    service = ViewingService(
        CheckoutStore(sqlite3.connect(":memory:", isolation_level=None)),
        ViewingSettings.from_services(Settings(_env_file=None)),
    )
    now = datetime.now(UTC)
    # These are internal transaction records, not external Housing search responses.
    for number in (1, 2):
        listing_id = str(number)
        service.store.put_tx(
            ServiceTransaction(
                transaction_id=f"internal-{number}",
                user_id="actor",
                thread_id="thread",
                logical_key=f"housing:{listing_id}",
                domain="property",
                option_id=listing_id,
                status="visited",
                details={"viewing": {"slot": (now - timedelta(hours=1)).isoformat()}},
                created_at=now,
                updated_at=now,
            )
        )
    return service


def begin(service, key="decision-key-0001", listing_id="1", keep_ids=None, **form):
    return service.begin_decision(
        "actor",
        "thread",
        listing_id,
        keep_ids or [],
        {"rent_vnd": 1, "deposit_vnd": 1, "move_in": None, **form},
        key,
    )


@pytest.mark.parametrize("status", ["agreed", "reported_paid"])
@pytest.mark.parametrize("outcome", ["missed", "met_rejected", "met_agreed", "met_undecided"])
def test_visit_cannot_downgrade_a_decided_home(status, outcome):
    service = service_and_records()
    decision = begin(service)
    service.finish_decision(decision)
    if status == "reported_paid":
        service.report_paid("actor", "thread", 2, datetime.now(UTC).date().isoformat())
    before = service.store.current_tx("actor", "thread", "housing:1").model_dump_json()
    with pytest.raises(CheckoutError) as error:
        service.visit("actor", "thread", "1", outcome)
    assert error.value.code == "visit_state_conflict"
    assert service.store.current_tx("actor", "thread", "housing:1").model_dump_json() == before


@pytest.mark.parametrize(
    "form",
    [
        {"rent_vnd": 2},
        {"deposit_vnd": 2},
        {"move_in": "2030-01-01"},
    ],
)
def test_same_key_rejects_a_changed_agreement(form):
    service = service_and_records()
    original = begin(service)
    with pytest.raises(CheckoutError) as error:
        begin(service, **form)
    assert error.value.code == "decision_payload_mismatch"
    assert service.store.get_decision(original["decision_key"]) == original


def test_same_key_rejects_changed_backup_choices():
    service = service_and_records()
    original = begin(service, keep_ids=["2"])
    with pytest.raises(CheckoutError) as error:
        begin(service, keep_ids=[])
    assert error.value.code == "decision_payload_mismatch"
    assert service.store.get_decision(original["decision_key"])["keep"] == ["2"]


def test_cancelled_selection_cannot_be_resurrected_by_an_old_intent():
    service = service_and_records()
    decision = begin(service)
    service.unselect("actor", "thread", "1")
    with pytest.raises(CheckoutError) as error:
        service.finish_decision(decision)
    assert error.value.code == "decision_stale"
    assert service.store.current_tx("actor", "thread", "housing:1").status == "dropped"


def test_changed_consideration_set_invalidates_the_old_intent():
    service = service_and_records()
    decision = begin(service)
    service.unselect("actor", "thread", "2")
    with pytest.raises(CheckoutError) as error:
        service.finish_decision(decision)
    assert error.value.code == "decision_stale"
    assert service.store.current_tx("actor", "thread", "housing:1").status == "visited"


def test_two_prepared_decisions_cannot_replace_each_other():
    service = service_and_records()
    first = begin(service, keep_ids=["2"])
    second = begin(service, key="decision-key-0002", listing_id="2")
    service.finish_decision(first)
    with pytest.raises(CheckoutError) as error:
        service.finish_decision(second)
    assert error.value.code == "decision_stale"
    assert service.store.current_tx("actor", "thread", "housing:1").status == "agreed"
    assert service.store.current_tx("actor", "thread", "housing:2").status == "backup"


def test_replay_after_reopening_does_not_claim_a_home_was_decided_again():
    service = service_and_records()
    decision = begin(service)
    service.finish_decision(decision)
    service.reopen("actor", "thread")
    with pytest.raises(CheckoutError) as error:
        begin(service)
    assert error.value.code == "decision_stale"
    assert service.store.current_tx("actor", "thread", "housing:1").status == "visited"


def test_retry_after_completion_is_read_only_and_keeps_the_same_result():
    service = service_and_records()
    decision = begin(service, keep_ids=["2"])
    first = service.finish_decision(decision)
    before = [t.model_dump_json() for t in service.items("actor", "thread")]
    assert begin(service, keep_ids=["2"])["step"] == "done"
    assert service.finish_decision(decision) == first
    assert [t.model_dump_json() for t in service.items("actor", "thread")] == before


def test_store_commit_is_atomic_when_sqlite_rejects_a_backup_update():
    service = service_and_records()
    decision = begin(service, keep_ids=["2"])
    before = [t.model_dump_json() for t in service.items("actor", "thread")]
    service.store.db.execute("""
        CREATE TRIGGER refuse_backup BEFORE UPDATE ON checkout_transactions
        WHEN json_extract(NEW.data, '$.status') = 'backup'
        BEGIN SELECT RAISE(ABORT, 'constraint rejects backup update'); END
    """)
    with pytest.raises(sqlite3.IntegrityError):
        service.finish_decision(decision)
    assert [t.model_dump_json() for t in service.items("actor", "thread")] == before
    assert service.store.get_decision(decision["decision_key"])["step"] == "planned"
    service.store.db.execute("DROP TRIGGER refuse_backup")
    assert service.finish_decision(decision)["status"] == "agreed"
