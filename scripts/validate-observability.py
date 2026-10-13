"""Validate pinned images/configs; --smoke runs an isolated local stack with disposable data."""

import argparse
import base64
import concurrent.futures
import importlib.util
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/observability"
spec = importlib.util.spec_from_file_location("render_observability", ROOT / "scripts/render-observability.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def docker(*args, timeout=600, env=None):
    result = subprocess.run(["docker", *map(str, args)], text=True, capture_output=True, timeout=timeout, env=env)
    if result.returncode:
        # Only disposable test configuration is used by this script.
        raise RuntimeError(result.stderr[-4000:] or result.stdout[-4000:])
    return result.stdout.strip()


def images(include_smoke=False):
    refs = set()
    for filename in ("compose.yaml", "compose.collector.yaml"):
        refs.update(service["image"] for service in yaml.safe_load((SOURCE / filename).read_text())["services"].values())
    if include_smoke:
        fixture = yaml.safe_load((ROOT / "tests/fixtures/observability-object-storage.yaml").read_text())
        refs.update(service["image"] for service in fixture["services"].values())

    def verify(ref):
        manifest = json.loads(docker("buildx", "imagetools", "inspect", ref, "--format", "{{json .Manifest}}", timeout=60))
        if not any(item.get("platform", {}).get("architecture") == "arm64" for item in manifest.get("manifests", [])):
            raise RuntimeError("No ARM64 manifest: " + ref)
        return ref
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for image in pool.map(verify, sorted(refs)):
            print("ARM64 image verified:", image, flush=True)


def request(url, *, headers=None, body=None, method=None):
    payload = json.dumps(body).encode() if body is not None else None
    hdr = {"Content-Type": "application/json", **(headers or {})}
    with urlopen(Request(url, data=payload, headers=hdr, method=method), timeout=10) as response:
        content = response.read()
        return json.loads(content) if content else {}


def eventually(check, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (HTTPError, URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(2)
    raise RuntimeError("Timed out waiting for local smoke assertion")


def application_trace(path, collector, token, database_url):
    workspace = ROOT
    env = {**os.environ, "OBSERVABILITY_ENABLED": "true", "OBSERVABILITY_CONTENT_MODE": "redacted",
           "OTEL_EXPORTER_OTLP_ENDPOINT": collector, "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer%20" + token,
           "OTEL_DEPLOYMENT_ENVIRONMENT": "staging", "OTEL_SERVICE_NAME": "smoke-node",
           "SMOKE_DATABASE_URL": database_url, "SMOKE_MCP_TOKEN": "smoke-" + secrets.token_hex(32)}
    with (path / "node.stdout").open("w") as stdout, (path / "node.stderr").open("w") as stderr:
        child = subprocess.Popen(["node", "--import", "@relohome/telemetry/register",
            "packages/telemetry/tests/mcp-postgres.mjs"], cwd=workspace, env=env, stdout=stdout, stderr=stderr)
        try:
            endpoint = eventually(lambda: next((line for line in (path / "node.stdout").read_text().splitlines()
                                                if line.startswith("http://")), None), timeout=20)
            env.update(SMOKE_MCP_URL=endpoint, OTEL_SERVICE_NAME="smoke-python")
            result = subprocess.run([sys.executable, "-m", "tests.observability_http_process"], cwd=ROOT,
                                    env=env, text=True, capture_output=True, timeout=30)
            if result.returncode:
                raise RuntimeError(result.stderr[-4000:])
            return result.stdout.strip().splitlines()[-1]
        finally:
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def materialize_coolify_content(path):
    """Use the exact files Coolify writes, without Docker Compose interpolation."""
    for kind in ("stack", "collector"):
        rendered = renderer.render(path / ("coolify-" + kind), kind=kind, coolify=True)
        definition = yaml.safe_load(rendered.read_text())
        for service in definition["services"].values():
            for mount in service.get("volumes", []):
                if isinstance(mount, dict) and "content" in mount:
                    destination = path / mount["source"].removeprefix("./")
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_text(mount["content"])


def local_storage_environment():
    """Always replace caller bucket settings with disposable, local-only values."""
    values = {
        "BUCKET": "smoke-" + secrets.token_hex(8), "PREFIX": "events/", "REGION": "us-east-1",
        "ACCESS_KEY_ID": "smoke-" + secrets.token_hex(8), "SECRET_ACCESS_KEY": secrets.token_hex(32),
        "ENDPOINT": "http://smoke-object-storage:9000", "FORCE_PATH_STYLE": "true",
    }
    return {"LANGFUSE_S3_EVENT_UPLOAD_" + key: value for key, value in values.items()}


def add_smoke_object_storage(definition):
    fixture = yaml.safe_load((ROOT / "tests/fixtures/observability-object-storage.yaml").read_text())
    definition["services"].update(fixture["services"])
    definition["volumes"].update(fixture["volumes"])
    for name in ("langfuse", "langfuse-worker"):
        definition["services"][name]["depends_on"]["smoke-object-storage-init"] = {
            "condition": "service_completed_successfully"}


def compose_environment(values):
    # Compose shell values override --env-file, so explicitly prefer generated test values.
    return {**os.environ, **values}


def main(smoke=False, verify_images=False):
    if verify_images:
        images(include_smoke=smoke)
    with tempfile.TemporaryDirectory(prefix="p044-observability-") as tmp:
        path = Path(tmp)
        compose = renderer.render(path)
        materialize_coolify_content(path)
        definition = yaml.safe_load(compose.read_text())
        services = definition["services"]
        project = "p044-observability-test-" + secrets.token_hex(4)
        definition["name"] = project
        definition["networks"]["ingestion"]["name"] = project + "-ingest"
        env = {key: secrets.token_hex(32) for key in (
            "LF_POSTGRES_PASSWORD", "LF_CLICKHOUSE_PASSWORD", "LF_REDIS_PASSWORD", "LF_SALT", "LF_ENCRYPTION_KEY",
            "LF_NEXTAUTH_SECRET", "OBS_ADMIN_PASSWORD", "GRAFANA_ADMIN_PASSWORD")}
        env.update(local_storage_environment())
        env.update(OBS_ADMIN_EMAIL="smoke@example.com", DISCORD_WEBHOOK_URL="http://127.0.0.1:9/disabled",
                   LANGFUSE_INIT_ORG_ID="smoke-" + secrets.token_hex(8),
                   LANGFUSE_STAGING_PROJECT_ID="smoke-staging", LANGFUSE_PRODUCTION_PROJECT_ID="smoke-production",
                   OBSERVABILITY_INGEST_NETWORK=project + "-ingest")
        passwords = {name: secrets.token_hex(16) for name in ("staging", "production")}
        caddy = services["telemetry-gateway"]["image"]
        for name, password in passwords.items():
            env[name.upper() + "_INGEST_PASSWORD_HASH"] = docker("run", "--rm", caddy, "caddy", "hash-password", "--plaintext", password)
        public_key, secret_key = "pk-lf-" + secrets.token_hex(16), "sk-lf-" + secrets.token_hex(16)
        env["LANGFUSE_STAGING_AUTH"] = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
        services["langfuse"]["environment"].update(LANGFUSE_INIT_PROJECT_ID="smoke-staging",
            LANGFUSE_INIT_PROJECT_NAME="smoke-staging", LANGFUSE_INIT_PROJECT_PUBLIC_KEY=public_key,
            LANGFUSE_INIT_PROJECT_SECRET_KEY=secret_key)
        env_file = path / ".env"
        env_file.write_text("\n".join(f"{key}='{value}'" for key, value in env.items()) + "\n")
        env_file.chmod(0o600)
        cmd = ["compose", "--project-name", project, "--env-file", env_file, "-f", compose]

        def stack(*args, timeout=600):
            return docker(*cmd, *args, timeout=timeout, env=compose_environment(env))

        stack("config", "--quiet")
        print("Local Compose validated", flush=True)
        collector_image = yaml.safe_load((SOURCE / "compose.collector.yaml").read_text())["services"]["collector"]["image"]
        docker("run", "--rm", "-e", "OTEL_COLLECTOR_TOKEN=test-only", "-e", "OTEL_DEPLOYMENT_ENVIRONMENT=staging",
               "-e", "OBSERVABILITY_INGEST_PASSWORD=test-only", "-e", "OBSERVABILITY_GATEWAY_URL=http://telemetry-gateway:8080",
               "-v", f"{path / 'collector.yaml'}:/etc/config.yaml:ro", collector_image, "validate", "--config=/etc/config.yaml")
        # docker run does not implement Compose .env quoting/interpolation.
        container_env = [arg for key, value in env.items() for arg in ("-e", f"{key}={value}")]
        docker("run", "--rm", *container_env, "-v", f"{path / 'Caddyfile'}:/etc/caddy/Caddyfile:ro",
               caddy, "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
        docker("run", "--rm", "-v", f"{path / 'loki.yaml'}:/etc/loki/config.yaml:ro",
               "-v", f"{path / 'loki-limits.yaml'}:/etc/loki/limits.yaml:ro", services["loki"]["image"],
               "-config.file=/etc/loki/config.yaml", "-verify-config=true")
        docker("run", "--rm", "--entrypoint", "promtool", "-v", f"{path}:/etc/prometheus:ro",
               services["prometheus"]["image"], "check", "config", "/etc/prometheus/prometheus.yaml")
        print("Coolify-rendered Collector, gateway, Loki and Prometheus configs validated", flush=True)
        if not smoke:
            return
        add_smoke_object_storage(definition)
        shutil.copyfile(ROOT / "tests/observability_discord_receiver.py", path / "discord.py")
        services["discord-capture"] = {"image": services["retention"]["image"], "command": ["python", "/app/discord.py"],
            "volumes": ["./discord.py:/app/discord.py:ro"], "ports": ["127.0.0.1:0:8080"], "mem_limit": "64m"}
        services["grafana"]["environment"]["DISCORD_WEBHOOK_URL"] = "http://discord-capture:8080/api/webhooks/test/token"
        # Accelerate only test notification grouping; production keeps its five-minute grouping.
        alerts_path = path / "grafana/alerts.yaml"
        alerts = yaml.safe_load(alerts_path.read_text())
        alerts["policies"][0].update(group_wait="1s", group_interval="5s")
        alerts_path.write_text(renderer.dump(alerts))
        for name, port in {"langfuse": 3000, "grafana": 3000, "prometheus": 9090, "loki": 3100, "telemetry-gateway": 8080,
                           "postgres": 5432}.items():
            services[name]["ports"] = [f"127.0.0.1:0:{port}"]
        for name in ("staging", "production"):
            services["otel-" + name] = {"image": collector_image, "user": "0:0", "mem_limit": "512m",
                "command": ["--config=/etc/config.yaml"], "ports": ["127.0.0.1:0:4318"],
                "environment": {"OTEL_COLLECTOR_TOKEN": passwords[name], "OTEL_DEPLOYMENT_ENVIRONMENT": name,
                    "OBSERVABILITY_INGEST_PASSWORD": passwords[name], "OBSERVABILITY_GATEWAY_URL": "http://telemetry-gateway:8080"},
                "volumes": ["./collector.yaml:/etc/config.yaml:ro", f"queue-{name}:/var/lib/otelcol"],
                "networks": ["ingestion"]}
            definition["volumes"]["queue-" + name] = None
        compose.write_text(renderer.dump(definition))

        def endpoint(name, port):
            return "http://" + stack("port", name, port).strip()

        try:
            print("Starting disposable stack (first run downloads images and migrates Langfuse)", flush=True)
            stack("up", "--detach", "--wait", "--wait-timeout", "240", timeout=900)
            lf = endpoint("langfuse", 3000)
            auth = {"Authorization": "Basic " + env["LANGFUSE_STAGING_AUTH"]}
            eventually(lambda: request(lf + "/api/public/projects", headers=auth), timeout=180)
            grafana = endpoint("grafana", 3000)
            gf_auth = {"Authorization": "Basic " + base64.b64encode(f'admin:{env["GRAFANA_ADMIN_PASSWORD"]}'.encode()).decode()}
            eventually(lambda: request(grafana + "/api/health").get("database") == "ok")
            contacts = request(grafana + "/api/v1/provisioning/contact-points", headers=gf_auth)
            assert any(item["type"] == "discord" and item["uid"] == "rh-discord"
                       and item["name"] == "relohome-discord" for item in contacts)
            rules = request(grafana + "/api/v1/provisioning/alert-rules", headers=gf_auth)
            expected_rules = {"rh-http-errors", "rh-ai-errors", "rh-provider-limits", "rh-chat-latency",
                              "rh-heartbeat", "rh-collector-down", "rh-export-failures", "rh-retention"}
            assert expected_rules.issubset({rule["uid"] for rule in rules})
            dashboard = request(grafana + "/api/dashboards/uid/relohome-overview", headers=gf_auth)
            assert len(dashboard["dashboard"]["panels"]) >= 10
            source = request(grafana + "/api/datasources/uid/loki-staging", headers=gf_auth)
            assert source["jsonData"]["derivedFields"][0]["url"].endswith("/traces/${__value.raw}")
            print("Langfuse ready; Grafana Discord contact point and alert rules provisioned", flush=True)
            col = endpoint("otel-staging", 4318)
            col_auth = {"Authorization": "Bearer " + passwords["staging"]}
            gateway = endpoint("telemetry-gateway", 8080)
            stage_auth = {"Authorization": "Basic " + base64.b64encode(f'staging:{passwords["staging"]}'.encode()).decode()}
            try:
                request(gateway + "/production/v1/logs", headers=stage_auth, body={})
                raise AssertionError("Staging credentials crossed the production boundary")
            except HTTPError as error:
                assert error.code == 401
            trace_id = secrets.token_hex(16)
            now = time.time_ns()
            resource = {"attributes": [{"key": "service.name", "value": {"stringValue": "smoke"}},
                                       {"key": "environment", "value": {"stringValue": "production"}}]}
            trace_payload = {"resourceSpans": [{"resource": resource, "scopeSpans": [{"scope": {"name": "relohome"}, "spans": [
                {"traceId": trace_id, "spanId": secrets.token_hex(8), "name": "smoke.call", "kind": 2,
                 "startTimeUnixNano": str(now), "endTimeUnixNano": str(now + 1000000)}]}]}]}
            request(col + "/v1/traces", headers=col_auth, body=trace_payload)
            query = urlencode({"traceId": trace_id, "limit": 10, "fields": "core"})
            eventually(lambda: request(lf + "/api/public/v2/observations?" + query, headers=auth).get("data"))
            request(col + "/v1/logs", headers=col_auth, body={"resourceLogs": [{"resource": resource, "scopeLogs": [{"logRecords": [
                {"timeUnixNano": str(now), "severityNumber": 9, "body": {"stringValue": "private@example.com"},
                 "traceId": trace_id, "spanId": secrets.token_hex(8)}]}]}]})
            loki = endpoint("loki", 3100)
            log_query = urlencode({"query": '{service_name="smoke",environment="staging"}', "limit": 10})
            found = eventually(lambda: request(loki + "/loki/api/v1/query_range?" + log_query,
                                              headers={"X-Scope-OrgID": "staging"})["data"]["result"])
            assert "private@example.com" not in json.dumps(found)
            assert "application.log" in json.dumps(found)
            assert not request(loki + "/loki/api/v1/query_range?" + log_query,
                               headers={"X-Scope-OrgID": "production"})["data"]["result"]
            request(col + "/v1/metrics", headers=col_auth, body={"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"metrics": [
                {"name": "relohome.heartbeat", "unit": "s", "gauge": {"dataPoints": [{"asDouble": time.time(), "timeUnixNano": str(now)}]}}]}]}]})
            prom = endpoint("prometheus", 9090)
            metric_query = urlencode({"query": 'relohome_heartbeat_seconds{service_name="smoke",environment="staging"}'})
            eventually(lambda: request(prom + "/api/v1/query?" + metric_query)["data"]["result"])
            print("Traces, logs, metrics, redaction and environment isolation verified", flush=True)
            db_host = endpoint("postgres", 5432).removeprefix("http://")
            connected_id = application_trace(path, col, passwords["staging"],
                f'postgresql://langfuse:{env["LF_POSTGRES_PASSWORD"]}@{db_host}/langfuse')
            connected_query = urlencode({"traceId": connected_id, "limit": 100, "fields": "core,basic,metadata,io"})

            def connected_trace():
                observations = request(lf + "/api/public/v2/observations?" + connected_query, headers=auth)["data"]
                names = {item["name"] for item in observations}
                if not {"smoke_query", "smoke_agent", "agent.turn", "db.SELECT"}.issubset(names):
                    return False
                by_id = {item["id"]: item for item in observations}
                database = next(item for item in observations if item["name"] == "db.SELECT")
                chain = []
                while database:
                    chain.append(database["name"])
                    parent_id = database.get("parentObservationId")
                    if parent_id and parent_id not in by_id:
                        return False
                    database = by_id.get(parent_id)
                assert {"smoke_query", "smoke_agent", "agent.turn", "POST /chat"}.issubset(chain), chain
                assert "private@example.com" not in json.dumps(observations)
                return True
            eventually(connected_trace)
            print("Connected Python gateway -> LangGraph -> Node MCP -> PostgreSQL trace verified", flush=True)
            capture = endpoint("discord-capture", 8080)
            eventually(lambda: "[firing]" in json.dumps(request(capture)))
            request(col + "/v1/metrics", headers=col_auth, body={"resourceMetrics": [
                {"resource": {"attributes": [{"key": "service.name", "value": {"stringValue": name}}]},
                 "scopeMetrics": [{"metrics": [{"name": "relohome.heartbeat", "unit": "s", "gauge": {
                     "dataPoints": [{"asDouble": time.time(), "timeUnixNano": str(time.time_ns())}]}}]}]}
                for name in renderer.SERVICES]})
            eventually(lambda: "[resolved]" in json.dumps(request(capture)))
            print("Grafana Discord firing/resolved payloads verified against local capture", flush=True)
            old_id = secrets.token_hex(16)
            old_span = trace_payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
            old_span.update(traceId=old_id, startTimeUnixNano=str(now - 8 * 86400 * 10**9),
                            endTimeUnixNano=str(now - 8 * 86400 * 10**9 + 1000000))
            request(col + "/v1/traces", headers=col_auth, body=trace_payload)
            old_query = urlencode({"traceId": old_id, "limit": 10, "fields": "core"})
            eventually(lambda: request(lf + "/api/public/v2/observations?" + old_query, headers=auth).get("data"))
            stack("exec", "-T", "retention", "python", "/app/retention.py", timeout=1000)
            assert not request(lf + "/api/public/v2/observations?" + old_query, headers=auth).get("data")
            print("Seven-day cleanup deleted and verified an expired trace through Langfuse API", flush=True)
            stack("stop", "telemetry-gateway")
            retry_id = secrets.token_hex(16)
            trace_payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["traceId"] = retry_id
            old_span.update(startTimeUnixNano=str(time.time_ns()), endTimeUnixNano=str(time.time_ns() + 1000000))
            request(col + "/v1/traces", headers=col_auth, body=trace_payload)
            time.sleep(5)
            stack("start", "telemetry-gateway")
            query = urlencode({"traceId": retry_id, "limit": 10, "fields": "core"})
            eventually(lambda: request(lf + "/api/public/v2/observations?" + query, headers=auth).get("data"))
            print("Queued export recovered after gateway outage", flush=True)
        except Exception:
            print(stack("logs", "--tail", "10", "otel-staging", "telemetry-gateway", "langfuse-worker", "grafana")[-12000:], flush=True)
            raise
        finally:
            stack("down", "--volumes", "--remove-orphans", timeout=120)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    main(smoke=args.smoke, verify_images=args.images)
