"""Project-scoped Langfuse OSS cleanup. Standard library only; no raw SQL or customer data logs."""

import argparse
import json
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode
from urllib.request import Request, urlopen

STATE = {}


class Client:
    def __init__(self, base_url, auth):
        self.base_url, self.auth = base_url.rstrip("/"), auth

    def request(self, path, method="GET", body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = Request(self.base_url + path, data=data, method=method,
                      headers={"Authorization": "Basic " + self.auth, "Content-Type": "application/json"})
        with urlopen(req, timeout=30) as response:
            return json.loads(response.read() or b"{}")


def expired_traces(client, cutoff):
    # Freeze the query bounds and finish the read pass before any asynchronous deletion.
    params = {"fromStartTime": "1970-01-01T00:00:00.000Z", "toStartTime": cutoff,
              "limit": 100, "fields": "core"}
    seen, cursors = set(), set()
    while True:
        result = client.request("/api/public/v2/observations?" + urlencode(params))
        for observation in result["data"]:
            trace_id = observation.get("traceId")
            if trace_id:
                seen.add(trace_id)
        cursor = result.get("meta", {}).get("cursor")
        if not cursor:
            return seen
        if cursor in cursors:
            raise RuntimeError("repeated pagination cursor")
        cursors.add(cursor)
        params["cursor"] = cursor


def cleanup(client, *, now=None, dry_run=False, sleep=time.sleep, verification_attempts=31):
    cutoff = ((now or datetime.now(UTC)) - timedelta(days=7)).isoformat()
    ids = sorted(expired_traces(client, cutoff))
    if dry_run:
        return len(ids)
    for offset in range(0, len(ids), 1000):
        client.request("/api/public/traces", "DELETE", {"traceIds": ids[offset:offset + 1000]})
    if ids:
        for _ in range(verification_attempts):
            if not (set(ids) & expired_traces(client, cutoff)):
                return len(ids)
            sleep(30)
        raise RuntimeError("trace deletion has not become visible")
    return len(ids)


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        selected = {"/metrics/staging": "staging", "/metrics/production": "production"}.get(self.path)
        if self.path != "/metrics" and selected is None:
            self.send_error(404)
            return
        lines = ["# TYPE relohome_retention_last_run_success gauge",
                 "# TYPE relohome_retention_last_success_timestamp_seconds gauge"]
        for environment, values in list(STATE.items()):
            if selected is not None and environment != selected:
                continue
            for metric, value in values.items():
                lines.append(f'relohome_retention_{metric}{{environment="{environment}"}} {value}')
        payload = ("\n".join(lines) + "\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def main(loop=False, dry_run=False):
    environments = os.getenv("OBSERVABILITY_ENVIRONMENTS", "staging").split(",")
    if not environments or any(env not in {"staging", "production"} for env in environments):
        raise SystemExit("Choose staging and/or production environments")
    if loop:
        server = ThreadingHTTPServer(("0.0.0.0", 9101), MetricsHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
    while True:
        failed = False
        for environment in environments:
            state = STATE.setdefault(environment, {"last_run_success": 0, "last_success_timestamp_seconds": 0})
            try:
                auth = os.environ["LANGFUSE_" + environment.upper() + "_AUTH"]
                if not auth:
                    raise ValueError("project credentials not configured")
                deleted = cleanup(Client(os.getenv("LANGFUSE_BASE_URL", "http://langfuse:3000"), auth), dry_run=dry_run)
                state.update(last_run_success=1, last_success_timestamp_seconds=int(time.time()))
                print(json.dumps({"event": "retention_completed", "environment": environment, "traces": deleted,
                                  "dry_run": dry_run}), flush=True)
            except Exception:
                failed = True
                state["last_run_success"] = 0
                print(json.dumps({"event": "retention_failed", "environment": environment}), flush=True)
        if not loop:
            return 1 if failed else 0
        time.sleep(900 if failed else 86400)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    raise SystemExit(main(loop=args.loop, dry_run=args.dry_run))
