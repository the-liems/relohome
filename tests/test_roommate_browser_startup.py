"""The direct Playwright server must work without the root npm launcher's environment."""
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_roommate_browser_server_bootstraps_runtime_root():
    run = 'review-startup-' + uuid.uuid4().hex
    env = {key: value for key, value in os.environ.items() if key != 'RELOHOME_RUNTIME_ROOT'}
    env['ROOMMATE_BROWSER_RUN'] = run
    try:
        subprocess.run([sys.executable, '-c', '''
import os
from fastapi.testclient import TestClient
from tests.browser_gateway.roommate_test_server import ROOT, app
assert os.environ['RELOHOME_RUNTIME_ROOT'] == str(ROOT)
with TestClient(app) as client:
    assert client.get('/health').status_code == 200
'''], cwd=ROOT, env=env, check=True)
    finally:
        shutil.rmtree(ROOT / 'logs/local' / run, ignore_errors=True)
