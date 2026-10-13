"""Disposable browser sessions against the running real Agent/Location/Moving services."""

import importlib.util
import os
from pathlib import Path

from relohome_gateway.server import create_app

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("audit_runner", ROOT / "scripts/local-integration.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
os.environ.update(runner.environment("ui"))
state = (ROOT / "logs/local" / os.environ["RUNTIME_AUDIT_RUN"]).resolve()
if not state.is_relative_to(ROOT / "logs/local"):
    raise ValueError("Audit sessions must stay in logs/local")
app = create_app(state / "web.sqlite3")
