"""Validate pinned images/configs; --smoke runs an isolated local stack with disposable data."""

import argparse
import base64
import concurrent.futures
import copy
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


def dump(value):
    return yaml.safe_dump(value, sort_keys=False, width=140)


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


def local_storage_environment():
    """Always replace caller bucket settings with disposable, local-only values."""
    values = {
        "BUCKET": "smoke-" + secrets.token_hex(8), "PREFIX": "events/", "REGION": "us-east-1",
        "ACCESS_KEY_ID": "smoke-" + secrets.token_hex(8), "SECRET_ACCESS_KEY": secrets.token_hex(32),
        "ENDPOINT": "http://smoke-object-storage:9000", "FORCE_PATH_STYLE": "true",
    }
    result = {"LANGFUSE_S3_EVENT_UPLOAD_" + key: value for key, value in values.items()}
    for backend in ("CORTEX", "LOKI"):
        result.update({backend + "_S3_" + key: value for key, value in {
            "BUCKET": backend.lower() + "-" + secrets.token_hex(8), "REGION": "us-east-1",
            "ENDPOINT": "smoke-object-storage:9000", "INSECURE": "true",
            "ACCESS_KEY_ID": values["ACCESS_KEY_ID"], "SECRET_ACCESS_KEY": values["SECRET_ACCESS_KEY"],
        }.items()})
    result.update(CORTEX_S3_BUCKET_LOOKUP_TYPE="path", LOKI_S3_FORCE_PATH_STYLE="true")
    return result


def add_smoke_object_storage(definition):
    fixture = yaml.safe_load((ROOT / "tests/fixtures/observability-object-storage.yaml").read_text())
    definition["services"].update(fixture["services"])
    definition["volumes"].update(fixture["volumes"])
    for name in ("langfuse", "langfuse-worker", "cortex", "loki"):
        definition["services"][name].setdefault("depends_on", {})["smoke-object-storage-init"] = {
            "condition": "service_completed_successfully"}


def compose_environment(values):
    # Compose shell values override --env-file, so explicitly prefer generated test values.
    return {**os.environ, **values}


def verify_s3_readback(path, definition, stack, endpoint, *, metric_time, log_query):
    """Read from empty-cache query-only processes after writers have uploaded to S3."""
    services = definition["services"]
    tenant = {"X-Scope-OrgID": "staging"}
    request(endpoint("cortex", 9009) + "/ingester/flush", headers=tenant, body={})

    def cortex_objects_uploaded():
        objects = stack("run", "--rm", "--no-deps", "--entrypoint", "sh", "smoke-object-storage-init", "-ec",
            'mc alias set local http://smoke-object-storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
            'mc ls --recursive "local/$CORTEX_BUCKET"')
        return "meta.json" in objects and "/chunks/" in objects

    eventually(cortex_objects_uploaded)
    stack("stop", "cortex")
    cortex_config = yaml.safe_load((path / "cortex.yaml").read_text())
    cortex_config["target"] = "querier,store-gateway"
    cortex_config["querier"].update(query_ingesters_within="1s", query_store_after="0s")
    # Scan new blocks directly; a fresh bucket has not had its first hourly compactor index pass.
    cortex_config["blocks_storage"]["bucket_store"].update(sync_interval="1s", bucket_index={"enabled": False})
    (path / "cortex-reader.yaml").write_text(dump(cortex_config))
    services["cortex-s3-reader"] = copy.deepcopy(services["cortex"])
    services["cortex-s3-reader"]["volumes"] = [
        "./cortex-reader.yaml:/etc/cortex/config.yaml:ro", "cortex-reader:/cortex"]
    definition["volumes"]["cortex-reader"] = None

    # Loki's TSDB index is shipped on shutdown. The restarted writer serves the reader's
    # compactor cache-generation API; the reader itself has no ingester or local data.
    request(endpoint("loki", 3100) + "/flush", headers=tenant, body={})
    stack("restart", "--timeout", "30", "loki")
    loki_config = yaml.safe_load((path / "loki.yaml").read_text())
    loki_config["common"]["compactor_grpc_address"] = "loki:9095"
    loki_config["querier"] = {"query_store_only": True}
    loki_config["storage_config"]["tsdb_shipper"]["resync_interval"] = "1s"
    (path / "loki-reader.yaml").write_text(dump(loki_config))
    services["loki-s3-reader"] = copy.deepcopy(services["loki"])
    services["loki-s3-reader"]["command"].append("-target=querier")
    services["loki-s3-reader"]["volumes"] = ["./loki-reader.yaml:/etc/loki/config.yaml:ro",
        "./loki-limits.yaml:/etc/loki/limits.yaml:ro", "loki-reader:/loki"]
    definition["volumes"]["loki-reader"] = None
    (path / "compose.yaml").write_text(dump(definition))
    stack("up", "--detach", "--no-deps", "cortex-s3-reader", "loki-s3-reader")
    cortex = endpoint("cortex-s3-reader", 9009)
    metric_query = urlencode({"query": 'relohome_heartbeat_seconds{service_name="smoke",environment="staging"}',
                              "time": metric_time + 1})
    result = eventually(lambda: request(cortex + "/prometheus/api/v1/query?" + metric_query,
                                       headers=tenant)["data"]["result"], timeout=120)
    assert len(result) == 1 and float(result[0]["value"][1]) > 0
    loki = endpoint("loki-s3-reader", 3100)
    def stored_logs():
        response = request(loki + "/loki/api/v1/query_range?" + log_query, headers=tenant)
        return response if response["data"]["result"] else None

    result = eventually(stored_logs, timeout=120)
    assert "application.log" in json.dumps(result["data"]["result"])
    stats = result["data"]["stats"]
    assert stats["ingester"]["totalReached"] == 0
    assert stats["querier"]["store"]["totalChunksDownloaded"] > 0
    print("Cortex and Loki S3-only reads verified with fresh volumes and no ingester reads", flush=True)


def main(smoke=False, verify_images=False):
    if verify_images:
        images(include_smoke=smoke)
    with tempfile.TemporaryDirectory(prefix="p044-observability-") as tmp:
        # Coolify deploys these Git files as they are; test a disposable copy of them.
        path = Path(tmp) / "observability"
        shutil.copytree(SOURCE, path)
        compose = path / "compose.yaml"
        definition = yaml.safe_load(compose.read_text())
        services = definition["services"]
        project = "p044-observability-test-" + secrets.token_hex(4)
        definition["name"] = project
        definition["networks"]["ingestion"]["name"] = project + "-ingest"
        env = {key: secrets.token_hex(32) for key in (
            "LF_POSTGRES_PASSWORD", "LF_CLICKHOUSE_PASSWORD", "LF_REDIS_PASSWORD", "LF_SALT", "LF_ENCRYPTION_KEY",
            "LF_NEXTAUTH_SECRET", "OBS_ADMIN_PASSWORD", "GRAFANA_ADMIN_PASSWORD")}
        env.update(local_storage_environment())
        env.update(OBS_ADMIN_EMAIL="smoke@example.com",
                   GRAFANA_ADMIN_USER="admin", OBSERVABILITY_ENVIRONMENTS="staging", LANGFUSE_PRODUCTION_AUTH="",
                   LANGFUSE_URL="http://localhost:3000", GRAFANA_URL="http://localhost:3001",
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
        docker("run", "--rm", *container_env, "-v", f"{path / 'loki.yaml'}:/etc/loki/config.yaml:ro",
               "-v", f"{path / 'loki-limits.yaml'}:/etc/loki/limits.yaml:ro", services["loki"]["image"],
               "-config.file=/etc/loki/config.yaml", "-config.expand-env=true", "-verify-config=true")
        docker("run", "--rm", *container_env, "-v", f"{path / 'cortex.yaml'}:/etc/cortex.yaml:ro",
               services["cortex"]["image"], "-config.file=/etc/cortex.yaml", "-config.expand-env=true", "-modules")
        print("Collector, gateway, Loki and Cortex configs parsed", flush=True)
        if not smoke:
            return
        add_smoke_object_storage(definition)
        # Test-only: flush the active Loki index at shutdown for the S3 readback proof.
        loki_config = yaml.safe_load((path / "loki.yaml").read_text())
        loki_config["ingester"]["wal"]["flush_on_shutdown"] = True
        (path / "loki.yaml").write_text(dump(loki_config))
        for name, port in {"langfuse": 3000, "grafana": 3000, "cortex": 9009, "loki": 3100, "telemetry-gateway": 8080,
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
        compose.write_text(dump(definition))

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
            rules = request(grafana + "/api/v1/provisioning/alert-rules", headers=gf_auth)
            expected_rules = {"rh-staging-" + name for name in ("http-errors", "ai-errors", "provider-limits", "chat-latency",
                              "heartbeat", "collector-down", "export-failures", "retention")}
            assert expected_rules == {rule["uid"] for rule in rules}
            assert all(rule["data"][0]["datasourceUid"] == "cortex-staging" for rule in rules)
            for tenant in ("staging", "production"):
                datasource = request(grafana + "/api/datasources/uid/cortex-" + tenant, headers=gf_auth)
                assert datasource["type"] == "prometheus" and datasource["url"] == "http://cortex:9009/prometheus"
            source = request(grafana + "/api/datasources/uid/loki-staging", headers=gf_auth)
            assert source["jsonData"]["derivedFields"][0]["url"].endswith("/traces/${__value.raw}")
            print("Langfuse ready; Grafana data sources and alert rules provisioned", flush=True)
            col = endpoint("otel-staging", 4318)
            col_auth = {"Authorization": "Bearer " + passwords["staging"]}
            gateway = endpoint("telemetry-gateway", 8080)
            stage_auth = {"Authorization": "Basic " + base64.b64encode(f'staging:{passwords["staging"]}'.encode()).decode()}
            for signal in ("logs", "metrics", "traces"):
                try:
                    request(gateway + "/production/v1/" + signal, headers=stage_auth, body={})
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
            cortex = endpoint("cortex", 9009)
            cortex_auth = {"X-Scope-OrgID": "staging"}
            metric_query = urlencode({"query": 'relohome_heartbeat_seconds{service_name="smoke",environment="staging"}'})
            eventually(lambda: request(cortex + "/prometheus/api/v1/query?" + metric_query, headers=cortex_auth)["data"]["result"])
            assert not request(cortex + "/prometheus/api/v1/query?" + metric_query,
                               headers={"X-Scope-OrgID": "production"})["data"]["result"]
            for name in ("collectors", "retention"):
                internal_query = urlencode({"query": f'up{{service_name="{name}",environment="staging"}}'})
                eventually(lambda: request(cortex + "/prometheus/api/v1/query?" + internal_query,
                                          headers=cortex_auth)["data"]["result"])
            request(col + "/v1/metrics", headers=col_auth, body={"resourceMetrics": [{"resource": resource,
                "scopeMetrics": [{"metrics": [
                    {"name": "relohome.http.requests", "sum": {"aggregationTemporality": 2, "isMonotonic": True,
                        "dataPoints": [{"asInt": "7", "startTimeUnixNano": str(now - 1000000000),
                            "timeUnixNano": str(time.time_ns()), "attributes": [{"key": "status", "value": {"stringValue": "200"}}]}]}},
                    {"name": "relohome.http.duration", "unit": "s", "histogram": {"aggregationTemporality": 2,
                        "dataPoints": [{"count": "2", "sum": 0.7, "bucketCounts": ["1", "1", "0"],
                            "explicitBounds": [0.25, 1], "startTimeUnixNano": str(now - 1000000000),
                            "timeUnixNano": str(time.time_ns())}]}},
                ]}]}]})
            for name in ("relohome_http_requests_total", "relohome_http_duration_seconds_count",
                         "relohome_http_duration_seconds_bucket", "otelcol_process_memory_rss",
                         "otelcol_exporter_sent_metric_points_total", "relohome_retention_last_run_success"):
                query = urlencode({"query": name + '{environment="staging"}'})
                eventually(lambda: request(cortex + "/prometheus/api/v1/query?" + query,
                                          headers=cortex_auth)["data"]["result"])
            # A caller-supplied tenant header cannot override gateway routing.
            request(gateway + "/staging/v1/metrics", headers={**stage_auth, "X-Scope-OrgID": "production"},
                    body={"resourceMetrics": [{"resource": {"attributes": [{"key": "service.name",
                        "value": {"stringValue": "tenant-routing-probe"}}]}, "scopeMetrics": [{"metrics": [
                        {"name": "relohome.routing.probe", "gauge": {"dataPoints": [{"asInt": "1",
                            "timeUnixNano": str(time.time_ns())}]}}]}]}]})
            route_query = urlencode({"query": 'relohome_routing_probe{service_name="tenant-routing-probe"}'})
            eventually(lambda: request(cortex + "/prometheus/api/v1/query?" + route_query,
                                      headers=cortex_auth)["data"]["result"])
            assert not request(cortex + "/prometheus/api/v1/query?" + route_query,
                               headers={"X-Scope-OrgID": "production"})["data"]["result"]
            print("Traces, logs, metric types, redaction, tenant isolation and internal scrapes verified", flush=True)
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
            storage_log_query = urlencode({"query": '{service_name="smoke",environment="staging"}',
                "start": str(now - 1000000000), "end": str(now + 1000000000), "limit": 10})
            verify_s3_readback(path, definition, stack, endpoint, metric_time=now / 10**9,
                               log_query=storage_log_query)
        except Exception:
            print(stack("logs", "--tail", "10", "otel-staging", "telemetry-gateway", "langfuse-worker", "grafana", "cortex", "loki")[-12000:], flush=True)
            raise
        finally:
            stack("down", "--volumes", "--remove-orphans", timeout=120)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    main(smoke=args.smoke, verify_images=args.images)
