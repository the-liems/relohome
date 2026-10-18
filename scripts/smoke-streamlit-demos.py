"""Launch installed demo scripts headlessly without providers, using disposable processes.

Run with the installed developer environment or wheels. Each demo receives an
random smoke port; normal root launchers retain 8501/8502/8501. No user data is
opened: cwd and Streamlit configuration are temporary, and only health is read.
"""

import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from importlib.resources import files
from pathlib import Path


def check(demo):
    script = files("relohome_demos") / f"{demo}.py"
    port = 20000 + secrets.randbelow(30000)
    with tempfile.TemporaryDirectory(prefix="relohome-demo-smoke-") as directory:
        log = Path(directory) / "streamlit.log"
        env = {**os.environ, "STREAMLIT_BROWSER_GATHER_USAGE_STATS": "false"}
        with log.open("w") as output:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-I",
                    "-m",
                    "streamlit",
                    "run",
                    str(script),
                    "--server.headless",
                    "true",
                    "--server.address",
                    "127.0.0.1",
                    "--server.port",
                    str(port),
                    "--browser.gatherUsageStats",
                    "false",
                    "--server.fileWatcherType",
                    "none",
                ],
                cwd=directory,
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
            )
            try:
                for _ in range(40):
                    if process.poll() is not None:
                        raise RuntimeError(log.read_text())
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/_stcore/health", timeout=1) as response:
                            assert response.status == 200
                            print(f"PASS {demo}: installed script, headless startup and health", flush=True)
                            return
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.25)
                raise RuntimeError("Startup timed out: " + log.read_text())
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)


if __name__ == "__main__":
    failures = []
    for name in ("flight_demo", "payment_demo", "agent_chat"):
        try:
            check(name)
        except Exception as exc:  # noqa: BLE001 - report every demo's failure, then exit non-zero
            failures.append(name)
            print(f"FAIL {name}: {exc}", file=sys.stderr)
    sys.exit(bool(failures))
