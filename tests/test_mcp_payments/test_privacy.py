"""Dữ liệu cá nhân không bao giờ rời máy nhóm (ADR-015)."""

import json
import re
from pathlib import Path

import pytest
from relohome_payment.engine import PaymentEngine
from relohome_payment.errors import InvalidRequestError, PaymentNotFoundError
from relohome_payment.privacy import (
    check_opaque_ref,
    gateway_ref_pattern,
    new_gateway_ref,
    pseudonym,
    redact_secrets,
)
from relohome_payment.storage import PaymentDatabase

from tests.test_mcp_payments.helpers import TEST_KEY1, TEST_KEY2, FakeClock, FakeZaloPay

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ALLOWED_CREATE_FIELDS = {
    "app_id",
    "app_trans_id",
    "app_user",
    "app_time",
    "expire_duration_seconds",
    "amount",
    "item",
    "embed_data",
    "description",
    "bank_code",
    "mac",
}
PII_SAMPLES = ["nguyen.van.a@gmail.com", "0901234567", "079201001234", "Nguyễn Văn A", "bk 1a2b"]


@pytest.mark.parametrize("value", PII_SAMPLES)
def test_rejects_personal_data_without_echoing_it(value: str) -> None:
    with pytest.raises(InvalidRequestError) as exc:
        check_opaque_ref(value, "order_ref")
    assert value not in str(exc.value)


@pytest.mark.parametrize("value", ["bk_1a2b3c4d5e6f", "ORDER-42", "guest"])
def test_accepts_opaque_internal_refs(value: str) -> None:
    assert check_opaque_ref(value, "order_ref") == value


def test_gateway_ref_has_date_team_prefix_and_random_suffix(clock: FakeClock) -> None:
    first, second = new_gateway_ref("P044", clock()), new_gateway_ref("P044", clock())
    assert gateway_ref_pattern("P044").match(first)
    assert first.startswith("261001_P044_") and first != second
    assert len(first) <= 40  # giới hạn app_trans_id của ZaloPay


def test_pseudonym_is_stable_salted_and_not_reversible() -> None:
    a = pseudonym("salt-1", "customer_42")
    assert a == pseudonym("salt-1", "customer_42")
    assert a != pseudonym("salt-2", "customer_42")
    assert "customer_42" not in a and re.fullmatch(r"[0-9a-f]{16}", a)


def test_pseudonym_salt_is_generated_once_and_kept(db: PaymentDatabase) -> None:
    salt = db.pseudonym_salt()
    assert len(salt) == 64 and db.pseudonym_salt() == salt
    assert db.pseudonym_salt("configured") == "configured"


def test_redact_secrets_recursively() -> None:
    data = {"mac": "abc", "nested": [{"key1": "k", "amount": 1}], "zp_trans_token": "t"}
    assert redact_secrets(data) == {"mac": "***", "nested": [{"key1": "***", "amount": 1}], "zp_trans_token": "***"}


@pytest.mark.asyncio
async def test_zalopay_receives_only_allowlisted_anonymous_fields(
    zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay
) -> None:
    payment = await zalopay_engine.create("bk_1a2b3c", 150_000, customer_ref="cust_9f8e7d")

    path, form = fake_zalopay.forms[0]
    assert path == "create" and set(form) == ALLOWED_CREATE_FIELDS
    assert form["expire_duration_seconds"] == "900"  # Thời lượng cấu hình 15 phút, không chứa dữ liệu khách.
    assert form["app_trans_id"] == payment.gateway_ref and gateway_ref_pattern("P044").match(form["app_trans_id"])
    assert form["description"] == f"P044 demo {payment.gateway_ref}"
    assert re.fullmatch(r"[0-9a-f]{16}", form["app_user"])
    assert form["item"] == "[]" and json.loads(form["embed_data"]) == {"redirecturl": "http://localhost:8502/"}
    sent = json.dumps(fake_zalopay.forms)
    for secret_or_internal in ("bk_1a2b3c", "cust_9f8e7d", TEST_KEY1, TEST_KEY2):
        assert secret_or_internal not in sent


@pytest.mark.asyncio
async def test_pii_is_rejected_before_anything_is_sent(
    zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay
) -> None:
    with pytest.raises(InvalidRequestError):
        await zalopay_engine.create("bk_ok", 50_000, customer_ref="an.nguyen@gmail.com")
    assert fake_zalopay.forms == []


@pytest.mark.asyncio
async def test_unknown_or_foreign_refs_are_never_queried(
    zalopay_engine: PaymentEngine, fake_zalopay: FakeZaloPay
) -> None:
    for ref in ("260926_P099_deadbeef", "260926_P044_deadbeef", "pay_unknown"):
        with pytest.raises(PaymentNotFoundError) as exc:
            await zalopay_engine.get(ref)
        assert ref not in str(exc.value)
    assert fake_zalopay.forms == []


@pytest.mark.asyncio
async def test_storage_keeps_no_customer_ref(zalopay_engine: PaymentEngine, db: PaymentDatabase) -> None:
    await zalopay_engine.create("bk_1a2b3c", 150_000, customer_ref="cust_9f8e7d")
    rows = db.conn.execute("SELECT * FROM payments").fetchall()
    assert "cust_9f8e7d" not in json.dumps(rows)


def test_env_example_has_no_payment_secrets() -> None:
    env = (PROJECT_ROOT / ".env.example").read_text(encoding="utf-8")
    for line in env.splitlines():
        if line.startswith(("PAYMENT_ZALOPAY_KEY1", "PAYMENT_ZALOPAY_KEY2")):
            assert line.split("=", 1)[1].strip() == "", f"Không được commit key: {line.split('=')[0]}"
