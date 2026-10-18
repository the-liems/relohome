"""Build affected workspace images and smoke their existing runtime paths without providers."""

import argparse
import json
import secrets
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {
    "backend": (8000, "/health", 200),
    "flights-mcp": (8765, "/health", 200),
    "payments-mcp": (8766, "/health", 200),
    "web": (8503, "/health", 200),
    "platform": (4100, "/", 404),  # /health requires a real PostGIS database
    "location": (3000, "/healthz", 200),
    "moving-api": (4200, "/health", 200),
    "moving-mcp": (4400, "/health", 200),
    "location-migrate": None,
    "moving-migrate": None,
}

PYTHON_SERVICES = {"backend", "web", "flights-mcp", "payments-mcp"}


def docker(*args, **kwargs):
    return subprocess.run(["docker", *args], cwd=ROOT, check=True, **kwargs)


def check(image, name):
    tag = f"p044-workspace-check-{name}:{secrets.token_hex(5)}"
    container = tag.replace(":", "-")
    try:
        command = ["buildx", "build", "--load", "-f", image["dockerfile"], "-t", tag]
        if image["target"]:
            command += ["--target", image["target"]]
        docker(*command, image["context"])
        if name in PYTHON_SERVICES:
            docker(
                "run",
                "-i",
                "--rm",
                "--network",
                "none",
                "--workdir",
                "/tmp",
                "--entrypoint",
                "python",
                tag,
                "-I",
                "-",
                name,
                "--require-nonroot",
                input=(ROOT / "scripts/check-python-install.py").read_bytes(),
            )
        if name == "web":
            subprocess.run([sys.executable, str(ROOT / "scripts/smoke-web-image.py"), tag], check=True)
            return
        if name.endswith("-migrate"):
            resource = "database/migrations" if name == "location-migrate" else "database/moving"
            entry = (
                "platform-api/dist/migrate.js"
                if name == "location-migrate"
                else "packages/moving-service/dist/migrate.js"
            )
            docker("run", "--rm", "--network", "none", "--entrypoint", "node", tag, "--check", entry)
            docker(
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "node",
                tag,
                "-e",
                f"if (!require('fs').readdirSync('/app/{resource}').some(x=>x.endsWith('.sql'))) process.exit(1)",
            )
            return
        # No mounts, published ports, real credentials or external network. Liveness
        # exercises the default USER/CMD; database readiness is a separate integration gate.
        env = {
            "LOCATION_DATABASE_URL": "postgresql://unused:unused@127.0.0.1:1/unused",
            "MOVING_DATABASE_URL": "postgresql://unused:unused@127.0.0.1:1/unused",
            "AHAMOVE_USER_TOKEN": "workspace-smoke-no-provider-access",
            "MCP_AUTH_TOKEN": "workspace-smoke-token-0123456789012345",
            "MOVING_MCP_AUTH_TOKEN": "workspace-smoke-token-0123456789012345",
            "MOVING_MCP_HOST": "0.0.0.0",
            "APP_ENV": "test",
            "OPENAI_API_KEY": "workspace-smoke-no-provider-access",
            "AGENT_API_TOKEN": "workspace-smoke-token-0123456789012345",
        }
        args = ["run", "-d", "--name", container, "--network", "none"]
        for key, value in env.items():
            args += ["-e", f"{key}={value}"]
        docker(*args, tag)
        port, path, expected = SERVICES[name]
        url = f"http://127.0.0.1:{port}{path}"
        probe = (
            ["python", "-c", f"import urllib.request; urllib.request.urlopen('{url}', timeout=2)"]
            if name in PYTHON_SERVICES
            else [
                "node",
                "-e",
                f"fetch('{url}').then(r=>process.exit(r.status==={expected}?0:1)).catch(()=>process.exit(1))",
            ]
        )
        for _ in range(30):
            result = subprocess.run(["docker", "exec", container, *probe], capture_output=True, timeout=10)
            if result.returncode == 0:
                print(f"{name}: default runtime HTTP startup passed", flush=True)
                return
            time.sleep(1)
        docker("logs", container)
        raise RuntimeError(f"{name}: startup/liveness failed")
    finally:
        subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "image", "rm", tag], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("services", nargs="*", help="Defaults to all four Python and six TypeScript images")
    args = parser.parse_args()
    names = args.services or list(SERVICES)
    if set(names) - SERVICES.keys():
        parser.error("Supported services: " + ", ".join(SERVICES))
    catalog = {item["service"]: item for item in json.loads((ROOT / "config/ci/application-images.json").read_text())}
    for name in names:
        check(catalog[name], name)
