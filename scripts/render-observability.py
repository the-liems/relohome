"""Render local or Coolify image-only observability resources; never reads runtime secrets."""

import argparse
import json
import shutil
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/observability"
SERVICES = ["web", "backend", "platform", "location", "moving-api", "moving-mcp", "flights-mcp", "payments-mcp"]


def dump(value):
    return yaml.safe_dump(value, sort_keys=False, width=140)


def alert(uid, title, expression, duration="0s", *, environment):
    datasource_uid = "cortex-" + environment
    return {
        "uid": f"rh-{environment}-{uid}", "title": f"{title} ({environment})", "condition": "B", "for": duration,
        "noDataState": "OK", "execErrState": "Error",
        "labels": {"team": "relohome", "severity": "warning", "environment": environment},
        "annotations": {"summary": title, "description": "Check the ReloHome dashboard and correlated traces."},
        "data": [
            {"refId": "A", "datasourceUid": datasource_uid, "relativeTimeRange": {"from": 900, "to": 0},
             "model": {"refId": "A", "expr": expression, "instant": True, "range": False,
                       "datasource": {"type": "prometheus", "uid": datasource_uid}}},
            {"refId": "B", "datasourceUid": "__expr__", "relativeTimeRange": {"from": 0, "to": 0},
             "model": {"refId": "B", "type": "threshold", "expression": "A",
                       "conditions": [{"type": "query", "evaluator": {"type": "gt", "params": [0]},
                                       "operator": {"type": "and"}, "reducer": {"type": "last", "params": []}}]}},
        ],
    }


def alert_config(environments=("staging",)):
    http_total = 'sum by (environment, service_name) (increase(relohome_http_requests_total[10m]))'
    http_failed = 'sum by (environment, service_name) (increase(relohome_http_requests_total{status=~"5.."}[10m]))'
    operations = 'sum by (environment, service_name, kind) (increase(relohome_operations_total{kind=~"agent|tool|llm"}[10m]))'
    errors = 'sum by (environment, service_name, kind) (increase(relohome_operations_total{kind=~"agent|tool|llm",outcome="error"}[10m]))'
    delivery_counters = ["exporter_send_failed_spans", "exporter_send_failed_log_records", "exporter_send_failed_metric_points",
                         "exporter_enqueue_failed_spans", "exporter_enqueue_failed_log_records", "exporter_enqueue_failed_metric_points",
                         "receiver_refused_spans", "receiver_refused_log_records", "receiver_refused_metric_points",
                         "receiver_failed_spans", "receiver_failed_log_records", "receiver_failed_metric_points"]
    # Cortex adds the counter suffix after the Collector scrape-to-OTLP conversion.
    delivery_errors = " or ".join(f"(rate(otelcol_{name}_total[5m]) > 0)" for name in delivery_counters)
    specs = [
        ("http-errors", "ReloHome HTTP error rate", f'({http_failed} / {http_total} > 0.05) and ({http_total} >= 20)'),
        ("ai-errors", "ReloHome agent/tool/provider failures", f'({errors} / {operations} > 0.05) and ({operations} >= 20)'),
        ("provider-limits", "ReloHome provider rate limits", 'sum by (environment, service_name, provider) (increase(relohome_provider_rate_limits_total[10m])) >= 3'),
        ("chat-latency", "ReloHome chat p95 above 120 seconds", '(histogram_quantile(0.95, sum by (le, environment, service_name) (rate(relohome_http_duration_seconds_bucket{route=~".*/chat"}[15m]))) > 120) and (sum by (environment, service_name) (increase(relohome_http_duration_seconds_count{route=~".*/chat"}[15m])) >= 10)'),
        ("heartbeat", "ReloHome service heartbeat missing", 'relohome_expected_service_info unless on (environment, service_name) (max by (environment, service_name) (relohome_heartbeat_seconds) > time() - 120)'),
        ("collector-down", "ReloHome Collector unavailable", '(up{service_name="collectors"} == bool 0) or absent(up{service_name="collectors"})', "2m"),
        ("export-failures", "ReloHome telemetry export failures", f'sum by (environment) ({delivery_errors}) > 0', "5m"),
        ("retention", "ReloHome trace retention cleanup failing", '(relohome_retention_last_run_success == bool 0) or (up{service_name="retention"} == bool 0) or absent(up{service_name="retention"})', "15m"),
    ]
    return {
        "apiVersion": 1,
        "groups": [{"orgId": 1, "name": "relohome-" + env, "folder": "ReloHome", "interval": "30s",
                    "rules": [alert(*spec, environment=env) for spec in specs]} for env in environments],
        "deleteRules": [{"orgId": 1, "uid": "rh-" + spec[0]} for spec in specs] + [
            {"orgId": 1, "uid": f"rh-{env}-{spec[0]}"} for env in ("staging", "production")
            if env not in environments for spec in specs],
    }


def datasources():
    sources = []
    for env in ("staging", "production"):
        sources.append({"name": "Cortex " + env, "uid": "cortex-" + env, "type": "prometheus", "access": "proxy",
            "url": "http://cortex:9009/prometheus", "isDefault": env == "staging", "editable": False,
            "jsonData": {"httpHeaderName1": "X-Scope-OrgID", "httpMethod": "POST"},
            "secureJsonData": {"httpHeaderValue1": env}})
        sources.append({"name": "Loki " + env, "uid": "loki-" + env, "type": "loki", "access": "proxy",
            "url": "http://loki:3100", "editable": False,
            "jsonData": {"httpHeaderName1": "X-Scope-OrgID", "derivedFields": [{
                "name": "Langfuse trace", "matcherType": "label", "matcherRegex": "trace_id",
                "url": "${LANGFUSE_URL}/project/${LANGFUSE_" + env.upper() + "_PROJECT_ID}/traces/$${__value.raw}",
                "urlDisplayLabel": "Open trace in Langfuse",
            }]}, "secureJsonData": {"httpHeaderValue1": env}})
    return {"apiVersion": 1, "deleteDatasources": [{"name": "Prometheus", "orgId": 1}], "datasources": sources}


def dashboard():
    queries = [
        ("HTTP requests / second", 'sum by (service_name) (rate(relohome_http_requests_total{environment="$environment"}[5m]))', "reqps"),
        ("HTTP 5xx / second", 'sum by (service_name) (rate(relohome_http_requests_total{environment="$environment",status=~"5.."}[5m]))', "reqps"),
        ("Request p95", 'histogram_quantile(0.95,sum by (le,service_name) (rate(relohome_http_duration_seconds_bucket{environment="$environment"}[5m])))', "s"),
        ("Agent and tool outcomes", 'sum by (kind,outcome) (rate(relohome_operations_total{environment="$environment"}[5m]))', "ops"),
        ("LLM tokens", 'sum by (model,direction) (increase(relohome_llm_tokens_total{environment="$environment"}[1h]))', "short"),
        ("Provider rate limits", 'sum by (provider) (increase(relohome_provider_rate_limits_total{environment="$environment"}[10m]))', "short"),
        ("Service heartbeat age", 'time() - max by (service_name) (relohome_heartbeat_seconds{environment="$environment"})', "s"),
        ("Collector queues", 'otelcol_exporter_queue_size{environment="$environment"}', "short"),
        ("Collector memory", 'otelcol_process_memory_rss{environment="$environment"}', "bytes"),
        ("Trace cleanup", 'relohome_retention_last_run_success{environment="$environment"}', "short"),
    ]
    panels = [{"id": i + 1, "title": title, "type": "timeseries", "datasource": {"type": "prometheus", "uid": "cortex-${environment}"},
        "gridPos": {"x": (i % 2) * 12, "y": (i // 2) * 8, "w": 12, "h": 8},
        "targets": [{"refId": "A", "expr": query, "legendFormat": "{{service_name}} {{kind}} {{outcome}} {{model}} {{direction}}"}],
        "fieldConfig": {"defaults": {"unit": unit}, "overrides": []}, "options": {"legend": {"displayMode": "list"}}}
        for i, (title, query, unit) in enumerate(queries)]
    panels.append({"id": 20, "title": "Operational logs — click trace_id to open Langfuse", "type": "logs",
        "datasource": {"type": "loki", "uid": "loki-${environment}"},
        "gridPos": {"x": 0, "y": 40, "w": 24, "h": 12},
        "targets": [{"refId": "A", "expr": '{environment="$environment"}', "queryType": "range"}],
        "options": {"showTime": True, "showLabels": False, "wrapLogMessage": True}})
    return {"uid": "relohome-overview", "title": "ReloHome operations", "schemaVersion": 39, "version": 1,
            "tags": ["relohome"], "timezone": "browser", "refresh": "30s", "time": {"from": "now-1h", "to": "now"},
            "templating": {"list": [{"name": "environment", "label": "Environment", "type": "custom",
                "query": "staging,production", "current": {"text": "staging", "value": "staging"},
                "options": [{"text": env, "value": env, "selected": env == "staging"} for env in ("staging", "production")]}]},
            "panels": panels}


def generated(environments):
    result = {
        "cortex-rules/" + env + "/expected-services.yaml": dump({"groups": [
            {"name": "relohome-inventory", "interval": "30s", "rules": [
                {"record": "relohome_expected_service_info", "expr": "vector(1)",
                 "labels": {"service_name": name, "environment": env}} for name in SERVICES]}
        ] if env in environments else []}) for env in ("staging", "production")
    }
    result.update({
        "grafana/alerts.yaml": dump(alert_config(environments)),
        "grafana/datasources.yaml": dump(datasources()),
        "grafana/dashboards.yaml": dump({"apiVersion": 1, "providers": [{"name": "ReloHome", "orgId": 1, "folder": "ReloHome",
            "type": "file", "disableDeletion": True, "options": {"path": "/var/lib/grafana/dashboards"}}]}),
        "grafana/overview.json": json.dumps(dashboard(), indent=2) + "\n",
    })
    return result


def render(output: Path, *, kind="stack", coolify=False, environments=("staging",)):
    output.mkdir(parents=True, exist_ok=True)
    filename = "compose.yaml" if kind == "stack" else "compose.collector.yaml"
    definition = yaml.safe_load((SOURCE / filename).read_text())
    extra = generated(environments) if kind == "stack" else {}
    for service in definition["services"].values():
        mounts = []
        for volume in service.get("volumes", []):
            if not volume.startswith("./"):
                mounts.append(volume)
                continue
            relative, target, *_ = volume.split(":")
            relative = relative.removeprefix("./")
            content = extra[relative] if relative in extra else (SOURCE / relative).read_text()
            if coolify:
                # Coolify extracts and writes content verbatim before Compose runs.
                # Keep each consumer's own interpolation/escaping (including Grafana $$).
                mounts.append({"type": "bind", "source": "./" + relative, "target": target,
                               "read_only": True, "content": content})
            else:
                destination = output / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(content)
                mounts.append(volume)
        service["volumes"] = mounts
        if coolify:
            service.pop("ports", None)
            if service.get("restart") == "no":
                service["exclude_from_hc"] = True
    target = output / ("compose.coolify.yaml" if coolify else "compose.yaml")
    target.write_text(dump(definition))
    if not coolify:
        shutil.copyfile(SOURCE / ".env.example", output / ".env.example")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kind", choices=["stack", "collector"], default="stack")
    parser.add_argument("--coolify", action="store_true")
    parser.add_argument("--environments", nargs="+", choices=["staging", "production"], default=["staging"])
    args = parser.parse_args()
    print(render(args.output, kind=args.kind, coolify=args.coolify, environments=args.environments))
