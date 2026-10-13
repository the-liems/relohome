"""Select affected PR images; release runs always build the complete catalog."""

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "config/ci/application-images.json"
GLOBAL_INPUTS = (
    ".github/workflows/",
    "config/ci/",
    "scripts/select-ci-images.py",
    "scripts/check-ci-runner.sh",
    "scripts/check-python-install.py",
    ".dockerignore",
)
NON_IMAGE_INPUTS = (
    "docs/", "tests/", "examples/streamlit/", "examples/design-reference/", "apps/browser-gateway/tests/", "apps/web/tests/", "eval/", "presentation/",
)


def matches(path, inputs):
    return any(path.startswith(item) if item.endswith("/") else path == item for item in inputs)


def select_images(catalog, paths):
    """Use explicit dependencies and rebuild everything for unclassified inputs."""
    selected = set()
    for path in paths:
        if matches(path, GLOBAL_INPUTS):
            return catalog
        if matches(path, NON_IMAGE_INPUTS):
            continue
        affected = []
        for image in catalog:
            context_ignore = str(Path(image["context"]) / ".dockerignore")
            inputs = [*image["paths"], image["dockerfile"], image["dockerfile"] + ".dockerignore", context_ignore]
            if matches(path, inputs):
                affected.append(image["service"])
        if affected:
            selected.update(affected)
        elif path.startswith("deploy/"):
            # Explicit catalog dependencies take priority: deploy/ now includes
            # migration SQL and the Moving Dockerfile as well as runtime config.
            continue
        elif not path.endswith(".md"):
            # New packages, build tooling, or unknown dependencies must not be
            # silently omitted. Narrow this only when their consumers are known.
            return catalog
    return [image for image in catalog if image["service"] in selected]


def changed_paths(base_sha):
    result = subprocess.run(
        ["git", "diff", "--name-only", "--no-renames", "-z", f"{base_sha}...HEAD"],
        cwd=ROOT, check=True, capture_output=True,
    )
    # --no-renames keeps both old and new paths, including deleted dependencies.
    return result.stdout.decode().rstrip("\0").split("\0") if result.stdout else []


def build_matrix(catalog):
    return {"include": [{key: image[key] for key in ("service", "context", "dockerfile", "target")}
                        for image in catalog]}


def main():
    catalog = json.loads(CATALOG.read_text())
    selected = catalog
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request":
        base_sha = os.environ.get("PR_BASE_SHA", "")
        if base_sha:
            try:
                selected = select_images(catalog, changed_paths(base_sha))
            except (subprocess.CalledProcessError, UnicodeDecodeError):
                print("Unable to classify the PR diff; building all images.")
        else:
            print("PR base SHA unavailable; building all images.")
    matrix = json.dumps(build_matrix(selected), separators=(",", ":"))
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"matrix={matrix}\ncount={len(selected)}\n")
    names = ", ".join(image["service"] for image in selected) or "none"
    print(f"Selected images: {names}")


if __name__ == "__main__":
    main()
