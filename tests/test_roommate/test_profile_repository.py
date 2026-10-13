from datetime import UTC, datetime

import pytest
from relohome_roommate.models import RoommateProfile, RoommateSearchCriteria
from relohome_roommate.ports import ProfileRecord
from relohome_roommate.profile_repository import SqlProfiles, VersionConflictError
from relohome_roommate.storage import Storage

NOW = datetime(2026, 10, 7, tzinfo=UTC)


def test_profile_restart_and_optimistic_owner_version(tmp_path):
    path = tmp_path / "db"
    item = ProfileRecord(owner_id="a", version=1, content=RoommateProfile(display_name="A"), updated_at=NOW)
    with Storage(path) as db:
        repo = SqlProfiles(db.connection)
        with db.transaction():
            repo.save(item, None)
        with pytest.raises(VersionConflictError), db.transaction():
            repo.save(item, None)
        with pytest.raises(VersionConflictError), db.transaction():
            repo.save(item.model_copy(update={"version": 2}), 0)
        with db.transaction():
            repo.save(item.model_copy(update={"version": 2}), 1)
    with Storage(path) as db:
        assert SqlProfiles(db.connection).get("a").version == 2
        assert SqlProfiles(db.connection).get("b") is None


def test_private_bookmarks_criteria_intro_and_access(tmp_path):
    with Storage(tmp_path / "db") as db:
        repo = SqlProfiles(db.connection)
        with db.transaction():
            repo.bookmark("a", "b", True)
            repo.bookmark("a", "b", True)
            repo.save_criteria("a", RoommateSearchCriteria(city="hcm"))
            repo.save_intro("a", RoommateProfile(display_name="Private"))
            repo.set_access("a", True, "terms", NOW)
        assert repo.bookmarks("a") == ["b"]
        assert repo.bookmarks("b") == []
        assert repo.criteria("a").city.value == "hcm"
        assert repo.intro("a").display_name == "Private"
        assert repo.access("a")["terms"] == "terms"
        assert repo.access("b") is None
        with db.transaction():
            repo.bookmark("a", "b", False)
        assert repo.bookmarks("a") == []


def test_write_requires_transaction(tmp_path):
    with Storage(tmp_path / "db") as db:
        with pytest.raises(RuntimeError):
            SqlProfiles(db.connection).bookmark("a", "b", True)
