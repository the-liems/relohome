"""Smoke the combined web image without providers, mounts, ports, or user data."""

import argparse
import subprocess
import uuid

# Executed inside the image from /tmp: no source tree or import-path overrides.
PROBE = r'''
import re
import time
import urllib.request
import relohome_gateway.server
import relohome_gateway.store
import relohome_gateway.roommate_gateway
import relohome_contracts, relohome_privacy, relohome_roommate, relohome_flight

base = "http://127.0.0.1:8503"
for attempt in range(40):
    try:
        with urllib.request.urlopen(base + "/health", timeout=2) as response:
            assert response.status == 200
        break
    except Exception:
        if attempt == 39:
            raise
        time.sleep(1)

def fetch(path):
    with urllib.request.urlopen(base + path, timeout=5) as response:
        assert response.status == 200
        return response.read(), response.headers.get_content_type()

index, content_type = fetch("/")
assert content_type == "text/html" and b"ReloHome" in index
asset = re.search(rb'<script[^>]+src="([^"]+\.js)"', index).group(1).decode()
body, asset_type = fetch(asset)
assert body and "javascript" in asset_type
fallback, fallback_type = fetch("/ai/relocation-smoke")
assert fallback == index and fallback_type == "text/html"
assert relohome_gateway.server.app.title == "ReloHome"
print("Installed gateway + shared imports, health, index, built JS and SPA fallback passed")
'''


def check(image):
    name = "p044-web-smoke-" + uuid.uuid4().hex[:12]
    try:
        subprocess.run([
            "docker", "run", "-d", "--name", name, "--network", "none",
            "-e", "APP_ENV=test", image,
        ], check=True)
        subprocess.run([
            "docker", "exec", "-i", "--workdir", "/tmp", name, "python", "-I", "-",
        ], input=PROBE, text=True, check=True, timeout=100)
    except Exception:
        subprocess.run(["docker", "logs", name], check=False)
        raise
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image")
    check(parser.parse_args().image)
