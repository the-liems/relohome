"""Pure date normalization checks; no mocked LLM, provider or test doubles."""

from relohome_agent.agents.intake_llm import explicit_date_evidence


def test_iso_evidence_uses_exact_user_date():
    text = "Đổi sang ngày 16/11/2026, vẫn hai người nhé"
    assert explicit_date_evidence("2026-11-16", "2026-11-16", text) == "16/11/2026"
    assert explicit_date_evidence("2026-11-16", "ngày 2026-11-16", text) == "16/11/2026"


def test_no_invented_or_relative_date_evidence():
    assert explicit_date_evidence("2026-11-17", "2026-11-17", "16/11/2026") == "2026-11-17"
    assert explicit_date_evidence("2026-11-16", "invented", "16/11/2026") == "invented"
    assert explicit_date_evidence("2026-11-16", "2026-11-16", "ngày mai") == "2026-11-16"
    assert explicit_date_evidence("2026-02-28", "2026-02-28", "31/02/2026") == "2026-02-28"
