"""Build-independent smoke of real images. No model/provider data is simulated.

Run after building both images. Credentials are fresh local service tokens, never printed.
Containers use random loopback ports and are removed; no production DB/volume is touched.
"""

import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4


def docker(*args, env=None):
    return subprocess.check_output(["docker", *args], env=env, text=True).strip()


def get(url, token=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=5) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def main():
    for service in ("intake", "orchestrator"):
        token = secrets.token_urlsafe(32)
        key = f"{service.upper()}_API_TOKEN"
        env = {**os.environ, key: token}
        name = f"lifeflow-{service}-smoke-{uuid4().hex[:8]}"
        started = False
        try:
            docker(
                "run",
                "-d",
                "--name",
                name,
                "-p",
                "127.0.0.1::8000",
                "-e",
                key,
                "--read-only",
                "--tmpfs",
                "/tmp",
                "--tmpfs",
                "/app/data:uid=10001,gid=10001",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges:true",
                f"lifeflow-{service}:local",
                env=env,
            )
            started = True
            port = json.loads(docker("inspect", name))[0]["NetworkSettings"]["Ports"]["8000/tcp"][0]["HostPort"]
            base = "http://127.0.0.1:" + port
            for _ in range(40):
                try:
                    if get(base + "/health")[0] == 200:
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(0.5)
            assert get(base + "/health")[0] == 200
            status, readiness = get(base + "/ready")
            if service == "intake":
                assert status == 503 and readiness["error"]["code"] == "NOT_READY"
            else:
                assert status == 200 and readiness["execution"] == "disconnected"
                assert get(base + "/v1/capabilities")[0] == 401
                status, capabilities = get(base + "/v1/capabilities", token)
                assert status == 200 and len(capabilities["registry"]["tools"]) == 13
            assert docker("exec", name, "id", "-u") == "10001"
            print(f"PASS {service}: real image, non-root, HTTP liveness/readiness, isolated configuration")
        finally:
            if started:
                subprocess.run(["docker", "rm", "-f", name], check=True, capture_output=True)


if __name__ == "__main__":
    main()
