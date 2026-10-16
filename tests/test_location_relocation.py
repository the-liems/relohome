"""Guard immutable migration assets and complete location file accounting."""

import csv
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTING = ROOT / "docs/integration/location-relocation/src-accounting.tsv"


def test_location_accounting_is_complete_and_destinations_exist():
    with ACCOUNTING.open() as source:
        rows = list(csv.DictReader(source, delimiter="\t"))
    assert len(rows) == len({row["old_path"] for row in rows}) == 108
    moved = [row for row in rows if row["disposition"] == "moved"]
    assert len(moved) == 104
    assert len({row["new_path"] for row in moved}) == len(moved)
    assert all((ROOT / row["new_path"]).is_file() for row in moved)
    assert all(not (ROOT / row["old_path"]).is_file() for row in rows)


def test_migrations_and_audit_sql_keep_their_original_bytes_and_order():
    with ACCOUNTING.open() as source:
        rows = [row for row in csv.DictReader(source, delimiter="\t") if "/database/" in row["old_path"]]
    for row in rows:
        assert hashlib.sha256((ROOT / row["new_path"]).read_bytes()).hexdigest() == row["base_sha256"]
    original = [Path(row["old_path"]).name for row in rows if "/migrations/" in row["old_path"]]
    current = sorted(path.name for path in (ROOT / "deploy/database/migrations").glob("*.sql"))
    # Existing relocated migrations stay byte-for-byte immutable and in order.
    # New features may append migrations after the original set.
    assert current[: len(original)] == original
    assert [name for name in current if name.startswith("008_")] == ["008_address_search.sql", "008_moving_service.sql"]
