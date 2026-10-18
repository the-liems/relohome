"""Verify installed wheel entrypoints/resources from outside the checkout (also in CI images).

Usage: python -I scripts/check-python-install.py backend
Images receive this script on stdin and run it from /tmp; no source tree is needed.
"""

import importlib
import json
import os
import sys
from importlib.metadata import distribution
from importlib.resources import files
from pathlib import Path

APPS = {
    "backend": ("relohome-agent", "relohome_agent", ["main", "roommate_runtime", "agents.subagents.services"]),
    "flights-mcp": ("relohome-flights-mcp", "relohome_flights_mcp", ["__main__", "server", "tools"]),
    "payments-mcp": ("relohome-payments-mcp", "relohome_payments_mcp", ["__main__", "server", "tools"]),
    "demos": (
        "relohome-demos",
        "relohome_demos",
        ["flight_client", "payment_client", "mcp_client", "map_picker", "mvp_components"],
    ),
    "web": ("relohome-browser-gateway", "relohome_gateway", ["server"]),
}


def verify(service):
    name, namespace, modules = APPS[service]
    installed = Path(distribution(name).locate_file("")).resolve()
    for suffix in modules:
        module = importlib.import_module(f"{namespace}.{suffix}")
        assert Path(module.__file__).resolve().is_relative_to(installed), module.__file__
    if service == "backend":
        resources = files("relohome_agent.agents.subagents") / "fixtures"
        for domain in ("flight", "map", "payment", "property", "relocation", "roommate"):
            assert json.loads((resources / f"{domain}.json").read_text())
    if service in {"backend", "flights-mcp", "web"}:
        resources = files("relohome_flight") / "catalog_data"
        for catalog in ("airports", "airlines"):
            assert json.loads((resources / f"{catalog}.json").read_text())
    print(f"PASS {service}: installed {name}, entrypoints and package resources")


if __name__ == "__main__":
    if "--require-nonroot" in sys.argv:
        assert os.geteuid() != 0, "Runtime image must use its non-root USER"
    verify(sys.argv[1])
