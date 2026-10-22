"""Send one synthetic OTLP log through a Collector and verify Loki readback.

Run from a host with access to both internal endpoints (or SSH tunnels).
Uses only the Python standard library; never reads application logs or secrets.
"""

import argparse
import json
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector", required=True, help="Collector HTTP base URL, use http://<Coolify-generated-collector-service-name>:4318")
    parser.add_argument("--loki", required=True, help="Loki base URL, e.g. http://loki:3100")
    parser.add_argument("--environment", required=True, choices=["development", "staging", "production"])
    parser.add_argument("--environment-label", choices=["deployment_environment_name", "environment"],
                        default="deployment_environment_name", help="Use environment for older deployed Collectors")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    marker = uuid.uuid4().hex
    start = time.time_ns()
    payload = {"resourceLogs": [{
        "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "logging-smoke"}}]},
        "scopeLogs": [{"scope": {"name": "relohome.logging.check"}, "logRecords": [{
            "timeUnixNano": str(start), "observedTimeUnixNano": str(start),
            "severityNumber": 9, "severityText": "INFO", "body": {"stringValue": "logging.export.check"},
            "traceId": marker, "spanId": uuid.uuid4().hex[:16],
        }]}],
    }]}
    request = Request(args.collector.rstrip("/") + "/v1/logs", data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read() or b"{}")
        partial = result.get("partialSuccess", {})
        if int(partial.get("rejectedLogRecords", 0)) or partial.get("errorMessage"):
            raise RuntimeError("Collector reported partial success; log delivery is not confirmed")
        print(f"Collector accepted synthetic log: {marker}")
        query = ('{service_name="logging-smoke",' + args.environment_label + '='
                 + json.dumps(args.environment) + '} | trace_id=' + json.dumps(marker))
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            params = urlencode({"query": query, "start": str(start - 5_000_000_000),
                                "end": str(time.time_ns()), "limit": 10})
            with urlopen(args.loki.rstrip("/") + "/loki/api/v1/query_range?" + params, timeout=10) as response:
                result = json.load(response)
            if result.get("status") != "success":
                raise RuntimeError("Loki query did not succeed")
            if any(stream.get("stream", {}).get("trace_id") == marker and stream.get("values")
                   for stream in result.get("data", {}).get("result", [])):
                print(f"PASS: log read back from Loki with environment={args.environment}")
                return 0
            time.sleep(1)
        raise RuntimeError("Collector accepted the log, but Loki readback timed out; check queues, export errors and environment")
    except HTTPError as error:
        print(f"FAIL: endpoint returned HTTP {error.code}")
    except (URLError, TimeoutError, RuntimeError, ValueError) as error:
        print(f"FAIL: {error}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
