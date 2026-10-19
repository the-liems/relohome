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
IMAGE_REPOSITORY_EXPRESSION = "${APPLICATION_IMAGE_REPOSITORY:-" + IMAGE_PREFIX.rstrip("/") + "}"


def release_images(definition):
    """Resolve the opt-in registry migration while retaining literal legacy releases."""
    repository = os.environ.get("APPLICATION_IMAGE_REPOSITORY") or IMAGE_PREFIX.rstrip("/")
    if not re.fullmatch(r"ghcr\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*", repository):
        raise ValueError("APPLICATION_IMAGE_REPOSITORY must be a lowercase GHCR repository without a tag")
    images = set()
    for service in definition["services"].values():
        image = service.get("image", "")
        if image.startswith(IMAGE_REPOSITORY_EXPRESSION + "/"):
            image = image.replace(IMAGE_REPOSITORY_EXPRESSION, repository, 1)
        if image.startswith((IMAGE_PREFIX, repository + "/")) and image.endswith(":${SOURCE_COMMIT}"):
            images.add(image)
    return images


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


def verify_saved_compose(application, expected):
    """Compare raw definitions without printing environment values or secrets."""
    source = application.get("docker_compose_raw")
    if not isinstance(source, str) or not source.strip():
        raise RuntimeError("Cannot verify Coolify Compose; the token needs read:sensitive to read docker_compose_raw")
    try:
        actual = yaml.safe_load(source)
    except yaml.YAMLError:
        raise RuntimeError("Coolify returned invalid Compose YAML; deployment stopped") from None
    if actual != expected:
        raise RuntimeError("Coolify Compose does not match the selected commit; deployment stopped")


def deploy(compose_path, *, preview_id=None, check_config=False, interval=10, deployment_timeout=3000, health_timeout=600):
    base = https_url(os.environ["COOLIFY_URL"], "COOLIFY_URL") + "/api/v1"
    app = os.environ["COOLIFY_APP_UUID"]
    sha = os.environ["DEPLOY_SHA"]
    token = os.environ["COOLIFY_TOKEN"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", app):
        raise ValueError("Set a valid Coolify Application UUID")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("DEPLOY_SHA must be a 40-hex commit SHA")
    release_ref = "coolify-release/" + sha
    if not token:
        raise ValueError("Set the Coolify API token")
    if preview_id is not None and not 1 <= preview_id <= 2147483647:
        raise ValueError("Preview ID must be a positive pull request number")
    if preview_id is not None and check_config:
        raise ValueError("--check-config is only supported for the main application, not previews")
    compose_source = Path(compose_path).read_text()
    definition = yaml.safe_load(compose_source)
    images = release_images(definition)
    if not images:
        raise ValueError("This commit predates Git-pinned deploys (its Compose file does not use ${SOURCE_COMMIT}); "
                         "deploy a commit at or after the Git-pinned deployment merge.")
    missing = []
    for image in sorted(images) if not check_config else []:
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
        # Reads are safe to retry after transient gateway or socket timeouts. A
        # write may already have reached Coolify, so never repeat it implicitly.
        for attempt in range(4):
            try:
                with urlopen(Request(base + path, data=data, headers=headers, method=method),
                             context=context, timeout=30) as response:
                    return json.load(response)
            except HTTPError as error:
                transient = error.code in {502, 503, 504, 524}
                message = f"Coolify {method} {path} returned HTTP {error.code}"
            except (TimeoutError, URLError) as error:
                transient = isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError)
                message = "Cannot reach Coolify with verified TLS; check runner network and server certificate"
            if method != "GET" or not transient or attempt == 3:
                raise RuntimeError(message) from None
            print(f"Coolify GET {path} temporarily unavailable; retrying status read ({attempt + 1}/3).")
            time.sleep(2 ** attempt)

    application_path = "/applications/" + app
    expected_repository = os.environ.get("GITHUB_REPOSITORY")
    if expected_repository and preview_id is None:
        repository = request(application_path).get("git_repository", "")
        match = re.fullmatch(r"(?:git@github\.com:|https://(?:[^/@]+@)?github\.com/)?"
                             r"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?", repository)
        if not match or match[1].lower() != expected_repository.lower():
            raise RuntimeError("Coolify Git repository does not match GITHUB_REPOSITORY; deployment stopped")
    if check_config:
        application = request(application_path)
        if application.get("git_commit_sha") != sha:
            raise RuntimeError("Coolify commit pin does not match the selected commit; configuration check failed")
        if application.get("git_branch") != release_ref:
            raise RuntimeError("Coolify Git source must use the selected coolify-release tag; configuration check failed")
        verify_saved_compose(application, definition)
        print(f"Coolify Application {app} commit pin and saved Compose match {sha}; no changes made.")
        return
    if preview_id is not None:
        queued = request(application_path + "/previews", "POST", {
            "pull_request_id": preview_id, "git_type": "github", "commit": sha,
        })
        deployment_id = queued.get("deployment_uuid")
        health_path = application_path + "/previews/" + str(preview_id)
    else:
        # Coolify reloads Compose with a branch/tag clone that ignores git_commit_sha.
        # The workflow creates this SHA-specific lightweight tag before calling us.
        request(application_path, "PATCH", {"git_commit_sha": sha, "git_branch": release_ref,
                                           "is_auto_deploy_enabled": False,
                                           "docker_compose_raw": compose_source,
                                           "include_source_commit_in_build": True,
                                           "is_container_label_escape_enabled": False})
        application = request(application_path)
        if application.get("git_commit_sha") != sha:
            raise RuntimeError("Coolify did not retain git_commit_sha; deployment stopped")
        if application.get("git_branch") != release_ref:
            raise RuntimeError("Coolify did not retain the release tag; deployment stopped")
        verify_saved_compose(application, definition)
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
    parser.add_argument("--check-config", action="store_true",
                        help="Check the commit pin and saved Compose without changing settings or deploying")
    args = parser.parse_args()
    try:
        deploy(args.compose, preview_id=args.preview_id, check_config=args.check_config)
    except (KeyError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
