"""Read-only Compose identity comparison against the pinned location base."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = "b714b7bbd57c521598191f0d958b48a17b270f47"
PAIRS = (
    ("location", "Maps VN/LifeFlow/infra", "deploy/location", ("compose.yaml",)),
    ("moving", "Maps VN/LifeFlow", "deploy/moving", ("compose.moving.yaml",)),
    ("moving-ci", "Maps VN/LifeFlow", "deploy/moving", ("compose.moving.yaml", "compose.moving.ci.yaml")),
    ("moving-staging-write", "Maps VN/LifeFlow", "deploy/moving", ("compose.moving.yaml", "compose.moving.staging-write.yaml")),
)
ENV = dict(os.environ)
for key in ("COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "COMPOSE_PROFILES"):
    ENV.pop(key, None)
for key in (
    "MOVING_DB_ADMIN_PASSWORD", "MOVING_DB_APP_PASSWORD", "MOVING_MCP_AUTH_TOKEN", "MOVING_MCP_WRITE_TOKEN",
    "MOVING_APPROVAL_TOKEN", "AHAMOVE_WEBHOOK_SECRET", "LOCATION_MCP_AUTH_TOKEN", "POSTGRES_ADMIN_PASSWORD",
    "POSTGRES_APP_PASSWORD",
):
    ENV[key] = "relocation-test-only-000000000000"
ENV.update(POSTGRES_DB="lifeflow", POSTGRES_ADMIN_USER="lifeflow_admin", POSTGRES_APP_USER="lifeflow_app", POSTGRES_PORT="5432")


def render(directory, files):
    args = ["docker", "compose", "--env-file", os.devnull, "--project-directory", str(directory)]
    for file in files:
        args.extend(("-f", str(file)))
    args.extend(("config", "--format", "json"))
    config = json.loads(subprocess.check_output(args, env=ENV, cwd=ROOT, text=True))
    return {
        "name": config["name"],
        "volumes": config.get("volumes", {}),
        "services": {
            name: {key: value for key, value in service.items() if key in {"image", "container_name", "build", "volumes"}}
            for name, service in config["services"].items()
        },
    }


def main():
    with tempfile.TemporaryDirectory() as temporary:
        for label, old, new, names in PAIRS:
            originals = []
            for name in names:
                path = Path(temporary) / name
                path.write_bytes(subprocess.check_output(["git", "show", f"{BASE}:{old}/{name}"], cwd=ROOT))
                originals.append(path)
            before = render(ROOT / old, originals)
            after = render(ROOT / new, [ROOT / new / name for name in names])
            for service in before["services"].values():
                if "build" in service:
                    service["build"]["dockerfile"] = service["build"]["dockerfile"].replace(
                        "Maps VN/LifeFlow/Dockerfile.moving", "deploy/moving/Dockerfile.moving"
                    )
            assert before == after, label
            print(f"{label}: project, images, containers, volumes, bind sources and build context match")


if __name__ == "__main__":
    main()
