"""Read-only validation of #118's pinned naming decision artifacts."""

import csv
import io
import re
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIRECTORY = Path(__file__).resolve().parent
SOURCE = "263c4a9e5f986758dbc78a237d61c3a7b8d8ff58"
INVENTORY = "481288a"
TOKEN = re.compile(r"[\w@./:-]*lifeflow[\w@./:-]*", re.IGNORECASE)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)


def read_rows(text):
    return list(csv.DictReader(io.StringIO(text), delimiter="\t"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    relative = DIRECTORY.relative_to(ROOT).as_posix()
    rows = read_rows((DIRECTORY / "naming-occurrences.tsv").read_text())
    original = read_rows(git("show", f"{INVENTORY}:{relative}/naming-occurrences.tsv"))
    require(len(rows) == len(original) == 1241, "Occurrence row count changed")
    evidence_fields = ("kind", "path", "line", "case_variants", "match_count", "review_lane")
    categories = set(re.findall(r"^\| (M\d+) \|", (DIRECTORY / "naming-inventory.md").read_text(), re.M))
    require(categories == {f"M{i:02}" for i in range(1, 27)}, "Incomplete matrix")
    source_cache = {}
    modes = {"rename", "preserve"}
    for row, old in zip(rows, original):
        key = (row["path"], row["line"])
        require(all(row[k] == old[k] for k in evidence_fields), f"Evidence changed: {key}")
        assigned = set(row["matrix_category"].split(";"))
        require(assigned and assigned <= categories, f"Unknown category: {key}")
        if row["kind"] == "path":
            require(row["decision"] == "rename" and assigned == {"M03"}, f"Path decision: {key}")
            continue
        path = row["path"]
        if path not in source_cache:
            source_cache[path] = git("show", f"{SOURCE}:{path}").splitlines()
        line = source_cache[path][int(row["line"]) - 1]
        tokens = TOKEN.findall(line)
        require(len(re.findall("lifeflow", line, re.I)) == int(row["match_count"]), f"Match count: {key}")
        decisions = row["token_decisions"].split("; ")
        require(len(decisions) == len(tokens), f"Missing token decision: {key}")
        token_categories, token_modes = set(), set()
        for ordinal, decision in enumerate(decisions, 1):
            number, category, mode = decision.split(":")
            require(number == str(ordinal) and category in categories and mode in modes, f"Invalid decision: {key}")
            token_categories.add(category)
            token_modes.add(mode)
        require(assigned == token_categories, f"Category union mismatch: {key}")
        expected = next(iter(token_modes)) if len(token_modes) == 1 else "mixed"
        require(row["decision"] == expected, f"Disposition mismatch: {key}")
    mapping = []
    for name in ("path-map.tsv", "current-base-additions.tsv"):
        current = read_rows((DIRECTORY / name).read_text())
        old = read_rows(git("show", f"{INVENTORY}:{relative}/{name}"))
        require(len(current) == len(old), f"Path row count changed: {name}")
        for row, prior in zip(current, old):
            require(row["old_path"] == prior["old_path"] and row["owner"] == prior["owner"], "Source ownership changed")
            require(not re.search(r"lifeflow_|scripts/lifeflow/|Start-LifeFlow|Stop-LifeFlow|tests/lifeflow.spec", row["target_path"]), f"Provisional target: {row}")
            require("proposed source name" not in row["action"], f"Provisional action: {row}")
        mapping.extend(current)
    tracked = set(git("ls-tree", "-r", "--name-only", SOURCE).splitlines())
    require(len(mapping) == len(tracked) == 1062, "Path coverage count changed")
    require({r["old_path"] for r in mapping} == tracked, "Path map not exhaustive")
    require(all(r["path"] in tracked for r in rows), "Evidence references untracked source")
    print(f"PASS: {len(rows)} naming rows; 26 categories; 1,062 source paths; original evidence preserved")
    print("Decisions:", dict(Counter(r["decision"] for r in rows)))


if __name__ == "__main__":
    main()
