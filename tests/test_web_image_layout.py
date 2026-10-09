"""The web runtime image must contain every gateway module the server imports (review PR #88)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def runtime_frontend_files() -> set[str]:
    """Files the runtime stage of Frontend/Dockerfile copies into ./Frontend/ from the build context."""
    files: set[str] = set()
    for line in (ROOT / "Frontend/Dockerfile").read_text().splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[0] != "COPY" or parts[-1] != "./Frontend/" or parts[1].startswith("--from"):
            continue
        for source in parts[1:-1]:
            files |= {path.name for path in ROOT.glob(source)}
    return files


def test_runtime_image_contains_every_imported_gateway_module():
    copied = runtime_frontend_files()
    assert {"__init__.py", "server.py", "store.py"} <= copied
    for name in sorted(copied):
        if not name.endswith(".py"):
            continue
        source = (ROOT / "Frontend" / name).read_text()
        for module in re.findall(r"^\s*(?:from|import) Frontend\.(\w+)", source, re.M):
            assert f"{module}.py" in copied, f"Frontend/{name} imports Frontend.{module}, missing from the web image"
