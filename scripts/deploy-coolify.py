"""Submit a published ARM64 GHCR release to Coolify; the platform handles rollout.

No GitHub App, deploy key or shared Docker daemon is needed.
Runtime secrets and private-registry pull credentials remain on Coolify's server.
"""

import argparse
import base64
import json
import os
import re
import ssl
import subprocess
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import yaml


def https_url(value, name):
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?/?", value):
        raise ValueError(f"{name} must be an HTTPS origin without credentials, path, query or fragment")
    return value.rstrip("/")


def render(source, image_prefix, tag):
    if not re.fullmatch(r"ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+", image_prefix):
        raise ValueError("Use a GHCR owner/repository image prefix")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", tag):
        raise ValueError("Use a valid release tag")
    # Replace only release metadata. Preserve all Compose fields and runtime variables.
    for key, value in {"IMAGE_PREFIX": image_prefix, "RELEASE_TAG": tag}.items():
        source = source.replace("${" + key + "}", value)
    return source


def deploy(compose_path, output):
    base = https_url(os.environ["COOLIFY_URL"], "COOLIFY_URL") + "/api/v1"
    resource = os.environ["COOLIFY_SERVICE_UUID"]
    tag = os.environ["RELEASE_TAG"]
    token = os.environ["COOLIFY_TOKEN"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", resource):
        raise ValueError("Set a valid Coolify Service UUID")
    content = render(Path(compose_path).read_text(), os.environ["IMAGE_PREFIX"], tag)
    Path(output).write_text(content)
    definition = yaml.safe_load(content)
    if not token:
        raise ValueError("Set the Coolify API token")
    # Inspect registry metadata without pulling layers or changing the Coolify resource.
    for image in sorted({service["image"] for service in definition["services"].values()}):
        try:
            subprocess.run(["docker", "manifest", "inspect", image], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
        except (OSError, subprocess.SubprocessError):
            raise RuntimeError(f"Cannot read image manifest for {image}; check the tag and registry access") from None
    context = ssl.create_default_context()
    if os.environ.get("COOLIFY_CA_CERT"):
        context.load_verify_locations(cadata=os.environ["COOLIFY_CA_CERT"])

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
            raise RuntimeError("Cannot reach Coolify with verified TLS; check runner network and CA") from None

    current = request("/services/" + resource)
    if "docker_compose_raw" not in current:
        raise RuntimeError("Coolify token needs read:sensitive to verify Compose; enable that ability before release")
    request("/services/" + resource, "PATCH", {"docker_compose_raw": base64.b64encode(content.encode()).decode()})
    saved = request("/services/" + resource)
    parsed = yaml.safe_load(saved.get("docker_compose_raw", ""))
    if parsed != definition:
        raise RuntimeError("Coolify did not retain the release Compose definition; deployment stopped")
    # New required variables must be supplied before starting this release.
    # Read values only to check presence; never print or persist runtime secrets.
    required = set(re.findall(r"(?<!\$)\$\{([A-Z][A-Z0-9_]*):\?[^}]*\}", content))
    variables = request("/services/" + resource + "/envs")
    values = {item["key"]: item.get("real_value", item.get("value")) for item in variables}
    missing = sorted(key for key in required if not values.get(key))
    if missing:
        raise RuntimeError("Set required Coolify variables before deployment: " + ", ".join(missing))
    # Moving accepts either auth form; Compose cannot express this either/or requirement.
    user_token, api_key, mobile = ((values.get(key) or "").strip() for key in
                                   ("AHAMOVE_USER_TOKEN", "AHAMOVE_API_KEY", "AHAMOVE_MOBILE"))
    auth_keys = {"AHAMOVE_USER_TOKEN", "AHAMOVE_API_KEY", "AHAMOVE_MOBILE"}
    uses_ahamove = any(key.split("=", 1)[0] in auth_keys
                       for service in definition["services"].values()
                       for key in (service.get("environment") or {}))
    if uses_ahamove and not user_token and not (api_key and mobile):
        raise RuntimeError("Set AHAMOVE_USER_TOKEN or both AHAMOVE_API_KEY and AHAMOVE_MOBILE before deployment")
    # /start rejects running services; restart also handles the first deployment.
    request("/services/" + resource + "/restart?latest=true", "POST")
    print(f"Coolify accepted the deployment request for {tag}. Follow rollout status in Coolify.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose", type=Path, default=Path(__file__).resolve().parents[1] / "compose.coolify.yaml")
    parser.add_argument("--output", type=Path, default=Path("coolify-release.yaml"))
    args = parser.parse_args()
    try:
        deploy(args.compose, args.output)
    except (KeyError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error)) from None
