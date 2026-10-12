"""Resolve an explicit test DB when runner and Docker daemon have different loopbacks.

Read-only Docker inspection is restricted to this job's published PostgreSQL
port and service alias. Runtime configuration and production URLs are untouched.
"""

import json
import os
import subprocess

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo


def _reachable(url):
    try:
        with psycopg.connect(url, connect_timeout=2) as connection:
            connection.execute("SELECT 1")
        return True
    except psycopg.OperationalError:
        return False


def resolve_database_url(url):
    params = conninfo_to_dict(url)
    if os.getenv("CI") != "true" or params.get("host") not in ("127.0.0.1", "localhost", "::1"):
        return url
    if _reachable(url):
        return url
    try:
        identifiers = subprocess.check_output(
            ["docker", "ps", "--filter", "ancestor=postgres:16", "--format", "{{.ID}}"], text=True, timeout=5
        ).splitlines()
        for identifier in identifiers[:32]:
            settings = json.loads(
                subprocess.check_output(
                    ["docker", "inspect", "--format", "{{json .NetworkSettings}}", identifier], text=True, timeout=5
                )
            )
            bindings = settings.get("Ports", {}).get("5432/tcp") or []
            if not any(binding.get("HostPort") == params.get("port") for binding in bindings):
                continue
            for network in settings.get("Networks", {}).values():
                if "roommate-postgres" not in (network.get("Aliases") or []):
                    continue
                # The daemon's gateway accepts the published port. Direct
                # bridge IP is also usable when the runner can route to it.
                for host, port in ((network.get("Gateway"), params["port"]), (network.get("IPAddress"), "5432")):
                    if host:
                        candidate = make_conninfo("", **{**params, "host": host, "port": port})
                        if _reachable(candidate):
                            return candidate
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    # Keep the explicit connection failure; never turn a configured PG gate
    # into a skipped test or silently fall back to SQLite.
    return url
