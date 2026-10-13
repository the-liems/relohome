"""The opt-in playground stays realistic enough to test discovery without real identities."""

import runpy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError
from relohome_roommate.demo import DemoDataset
from relohome_roommate.models import RoommateSearchCriteria
from relohome_roommate.policy import NeedKind

ROOT = Path(__file__).resolve().parents[2]
build_dataset = runpy.run_path(str(ROOT / "scripts/generate-roommate-demo.py"))["build_dataset"]


def test_thirty_profiles_are_balanced_searchable_and_explicitly_synthetic():
    now = datetime(2026, 10, 8, tzinfo=UTC)
    anchors = {city: [{"listing_id": f"test-{city}-room"}] for city in ("hanoi", "hcm", "danang")}
    dataset = build_dataset(anchors, now, count=30, valid_days=1095)

    assert len(dataset.profiles) == 30
    assert len({profile.owner_id for profile in dataset.profiles}) == 30
    assert {city: sum(p.content.facts.city == city for p in dataset.profiles) for city in anchors} == {
        "hanoi": 10,
        "hcm": 10,
        "danang": 10,
    }
    assert sorted(p.content.facts.self_traits.gender for p in dataset.profiles).count("male") == 15
    assert sorted(p.content.facts.self_traits.gender for p in dataset.profiles).count("female") == 15
    assert sum(p.content.facts.need.kind is NeedKind.HAS_ROOM for p in dataset.profiles) == 18
    assert all(p.expires_at == now + timedelta(days=1095) for p in dataset.profiles)
    assert all(p.content.display_name.startswith("DEMO ") for p in dataset.profiles)
    assert "phone" not in dataset.model_dump_json().lower()
    assert "zalo" not in dataset.model_dump_json().lower()

    result = dataset.search("viewer", RoommateSearchCriteria(city="hanoi"), now, 0, 12)
    assert result["total"] == 10
    assert result["notice"].startswith("30 hồ sơ giả")
    assert result["connections_enabled"] is False
    assert all(item["profile"]["profile_id"].startswith("demo_") for item in result["items"])


def test_demo_dataset_rejects_too_few_or_unlabeled_profiles():
    now = datetime(2026, 10, 8, tzinfo=UTC)
    anchors = {city: [{"listing_id": f"test-{city}-room"}] for city in ("hanoi", "hcm", "danang")}
    raw = build_dataset(anchors, now, count=30, valid_days=1095).model_dump(mode="json")
    with pytest.raises(ValidationError):
        DemoDataset.model_validate({**raw, "profiles": raw["profiles"][:-1]})
    raw["profiles"][0]["content"]["display_name"] = "Unlabeled name"
    with pytest.raises(ValidationError):
        DemoDataset.model_validate(raw)


def test_existing_hundred_profile_generator_remains_supported():
    now = datetime(2026, 10, 8, tzinfo=UTC)
    anchors = {city: [{"listing_id": f"test-{city}-room"}] for city in ("hanoi", "hcm", "danang")}
    assert len(build_dataset(anchors, now).profiles) == 100
