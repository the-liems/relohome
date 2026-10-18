"""Deploy a pinned Git commit through a Coolify Docker Compose Application."""

import argparse
import json
import os
import re
import ssl
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml

IMAGE_PREFIX = "ghcr.io/ai20k-build-phase-cohort-4/p-044/"


def https_url(value, name):
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?/?", value):
        raise ValueError(f"{name} must be an HTTPS origin without credentials, path, query or fragment")
    return value.rstrip("/")


def log_tail(deployment):
    try:
        logs = json.loads(deployment.get("logs") or "[]")
    except (ValueError, TypeError):
        logs = []
    lines = [line for entry in logs if not entry.get("hidden")
             for line in entry.get("output", "").splitlines()]
    if not lines:
        print("Coolify returned no deployment logs; the token needs read:sensitive to include them.")
    for line in lines[-40:]:
        print(line)


def deploy(compose_path, *, preview_id=None, interval=10, deployment_timeout=3000, health_timeout=600):
    base = https_url(os.environ["COOLIFY_URL"], "COOLIFY_URL") + "/api/v1"
    app = os.environ["COOLIFY_APP_UUID"]
    sha = os.environ["DEPLOY_SHA"]
    token = os.environ["COOLIFY_TOKEN"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", app):
        raise ValueError("Set a valid Coolify Application UUID")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("DEPLOY_SHA must be a 40-hex commit SHA")
    if not token:
        raise ValueError("Set the Coolify API token")
    if preview_id is not None and not 1 <= preview_id <= 2147483647:
        raise ValueError("Preview ID must be a positive pull request number")
    definition = yaml.safe_load(Path(compose_path).read_text())
    images = {service.get("image", "") for service in definition["services"].values()
              if service.get("image", "").startswith(IMAGE_PREFIX)
              and service.get("image", "").endswith(":${SOURCE_COMMIT}")}
    if not images:
        raise ValueError("This commit predates Git-pinned deploys (its Compose file does not use ${SOURCE_COMMIT}); "
                         "deploy a commit at or after the Git-pinned deployment merge.")
    missing = []
    for image in sorted(images):
        image = image.replace("${SOURCE_COMMIT}", sha)
        try:
            subprocess.run(["docker", "manifest", "inspect", image], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
        except (OSError, subprocess.SubprocessError):
            missing.append(image)
    if missing:
        raise RuntimeError("Cannot read image manifests; check tags and registry access: " + ", ".join(missing))
    context = ssl.create_default_context()

    def request(path, method="GET", body=None):
        headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        try:
            with urlopen(Request(base + path, data=data, headers=headers, method=method),
                         context=context, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"Coolify {method} {path} returned HTTP {error.code}") from None
        except URLError:
            raise RuntimeError("Cannot reach Coolify with verified TLS; check runner network and server certificate") from None

    application_path = "/applications/" + app
    if preview_id is not None:
        queued = request(application_path + "/previews", "POST", {
            "pull_request_id": preview_id, "git_type": "github", "commit": sha,
        })
        deployment_id = queued.get("deployment_uuid")
        health_path = application_path + "/previews/" + str(preview_id)
    else:
        request(application_path, "PATCH", {"git_commit_sha": sha, "is_auto_deploy_enabled": False,
                                           "include_source_commit_in_build": True,
                                           "is_container_label_escape_enabled": False})
        if request(application_path).get("git_commit_sha") != sha:
            raise RuntimeError("Coolify did not retain git_commit_sha; deployment stopped")
        queued = request("/deploy?uuid=" + app, "POST")
        deployment_id = next((item.get("deployment_uuid") for item in queued.get("deployments", [])
                              if item.get("resource_uuid") == app), None)
        health_path = application_path
    if not deployment_id:
        raise RuntimeError("Coolify did not return a deployment UUID for this Application")
    deadline = time.monotonic() + deployment_timeout
    while True:
        try:
            deployment = request("/deployments/" + deployment_id)
        except RuntimeError as error:
            if "HTTP 404" in str(error):
                raise RuntimeError("Coolify returned a deployment UUID that no longer exists (HTTP 404); "
                                   "the commit may already be queued. Check its deployment in Coolify.") from None
            raise
        status = deployment.get("status")
        if status in {"finished", "failed", "cancelled-by-user"}:
            break
        if time.monotonic() >= deadline:
            log_tail(deployment)
            raise RuntimeError(f"Coolify deployment timed out; last status: {status}")
        time.sleep(interval)
    if status != "finished":
        log_tail(deployment)
        raise RuntimeError(f"Coolify deployment {deployment_id} ended with status: {status}")
    if deployment.get("commit") != sha:
        raise RuntimeError(f"Coolify deployment commit mismatch: expected {sha}, got {deployment.get('commit')}")
    deadline = time.monotonic() + health_timeout
    while True:
        status = request(health_path).get("status")
        if status in {"running:healthy", "running:unknown"}:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Coolify Application never reached an accepted running status; last status: {status}")
        time.sleep(interval)
    target = f"Application {app}" + (f" preview PR #{preview_id}" if preview_id else "")
    print(f"Coolify {target} deployed {sha} and has status {status}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose", type=Path, default=Path(__file__).resolve().parents[1] / "compose.coolify.yaml")
    parser.add_argument("--preview-id", type=int, help="Deploy a PR preview without changing the main deployment")
    args = parser.parse_args()
    try:
        deploy(args.compose, preview_id=args.preview_id)
    except (KeyError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
