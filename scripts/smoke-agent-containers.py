"""Build-independent smoke of real images. No model/provider data is simulated.

Run after building both images. Credentials are fresh local service tokens, never printed.
HTTP probes run inside the container, supporting containerized runners without
publishing host ports. Containers are removed; no production DB/volume is touched.
"""

import json
import os
import secrets
import signal
import subprocess
import time
from uuid import uuid4


def docker(*args, env=None):
    return subprocess.check_output(["docker", *args], env=env, text=True).strip()


HTTP_PROBE = """
import json, os, socket, sys, urllib.error, urllib.request
ip = socket.gethostbyname(socket.gethostname())
url = "http://" + ip + ":8000" + sys.argv[1]
headers = {"Authorization": "Bearer " + os.environ[sys.argv[2]]} if len(sys.argv) > 2 else {}
try:
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=5) as response:
        print(json.dumps([response.status, json.load(response)]))
except urllib.error.HTTPError as exc:
    print(json.dumps([exc.code, json.load(exc)]))
"""


def get(container, path, token_key=None):
    # Reuse the container's environment, never put credentials in command args.
    args = ["exec", container, "python", "-c", HTTP_PROBE, path]
    if token_key:
        args.append(token_key)
    return json.loads(docker(*args))


def remove(container):
    result = subprocess.run(["docker", "rm", "-fv", container], capture_output=True, text=True)
    if result.returncode and "No such container" not in result.stderr:
        result.check_returncode()


def diagnose(container):
    try:
        print(docker("logs", "--tail", "100", container))
    except subprocess.CalledProcessError:
        pass


def main():
    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    for service in ("intake", "orchestrator"):
        token = secrets.token_urlsafe(32)
        key = f"{service.upper()}_API_TOKEN"
        env = {**os.environ, key: token}
        name = f"lifeflow-{service}-smoke-{uuid4().hex[:8]}"
        try:
            docker(
                "run",
                "-d",
                "--name",
                name,
                "--label",
                f"lifeflow.ci.agents={os.environ.get('AGENT_IMAGE_TAG', 'local')}",
                "-e",
                key,
                "--read-only",
                "--tmpfs",
                "/tmp",
                "--tmpfs",
                # Writable for the non-root user on both Docker and Podman (Podman rejects uid=/gid=).
                "/app/data:mode=1777",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges:true",
                f"lifeflow-{service}:{os.environ.get('AGENT_IMAGE_TAG', 'local')}",
                env=env,
            )
            for _ in range(40):
                try:
                    if get(name, "/health")[0] == 200:
                        break
                except (OSError, ValueError, subprocess.CalledProcessError):
                    pass
                time.sleep(0.5)
            assert get(name, "/health")[0] == 200
            status, readiness = get(name, "/ready")
            if service == "intake":
                assert status == 503 and readiness["error"]["code"] == "NOT_READY"
            else:
                assert status == 200 and readiness["execution"] == "disconnected"
                assert get(name, "/v1/capabilities")[0] == 401
                status, capabilities = get(name, "/v1/capabilities", key)
                assert status == 200 and len(capabilities["registry"]["tools"]) == 13
            assert docker("exec", name, "id", "-u") == "10001"
            print(f"PASS {service}: real image, non-root, HTTP liveness/readiness, isolated configuration")
        except BaseException:
            diagnose(name)
            raise
        finally:
            # docker run can create a container before returning an error.
            remove(name)


if __name__ == "__main__":
    main()
