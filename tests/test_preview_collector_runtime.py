"""Opt-in integration test: RUN_PREVIEW_COLLECTOR_TEST=1 pytest this file."""

import json
import os
import subprocess
import time
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(os.getenv('RUN_PREVIEW_COLLECTOR_TEST') != '1', reason='Requires a local Docker engine')
@pytest.mark.parametrize('environment,hostname,preview_id', [
    ('preview', 'pr-200.c4-app-044.io.vn', '200'),
    ('preview', 'pr-321.previews.example.net', '321'),
    ('preview', 'unexpected.example.net', None),
    ('preview', '', None),
    ('staging', 'pr-200.c4-app-044.io.vn', None),
    ('production', 'pr-200.c4-app-044.io.vn', None),
])
def test_real_collector_stamps_traces_logs_metrics_and_preserves_commit(tmp_path, environment, hostname, preview_id):
    config = yaml.safe_load((ROOT / 'deploy/observability/collector.yaml').read_text())
    # Keep the real receiver and processors; capture export locally instead of contacting shared backends.
    config['exporters'] = {'file/test': {'path': '/out/telemetry.json', 'format': 'json'}}
    del config['service']['pipelines']['metrics/internal']
    del config['receivers']['prometheus/internal']
    for pipeline in config['service']['pipelines'].values():
        pipeline['exporters'] = ['file/test']
    config['service']['extensions'] = ['health_check']
    del config['extensions']['file_storage']
    source = tmp_path / 'collector.yaml'
    source.write_text(yaml.safe_dump(config))
    image = 'otel/opentelemetry-collector-contrib:0.162.0'
    args = ['docker', 'run', '-d', '--user', '0:0', '-p', '127.0.0.1::4318',
            '-e', 'DEPLOYMENT_HOSTNAME=' + hostname, '-e', 'DEPLOYMENT_COMMIT=' + 'a' * 40,
            '-e', 'OTEL_DEPLOYMENT_ENVIRONMENT=' + environment,
            '-v', f'{source}:/config.yaml:ro', '-v', f'{tmp_path}:/out', image, '--config=/config.yaml']
    container = subprocess.check_output(args, text=True).strip()
    try:
        binding = subprocess.check_output(['docker', 'port', container, '4318/tcp'], text=True).strip()
        base = 'http://' + binding
        def send(path, payload):
            request = Request(base + path, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
            with urlopen(request, timeout=5) as response:
                assert response.status == 200

        deadline = time.monotonic() + 15
        while True:
            try:
                send('/v1/traces', {})
                break
            except (URLError, RemoteDisconnected, ConnectionError):
                if time.monotonic() > deadline:
                    pytest.fail(subprocess.check_output(['docker', 'logs', container], stderr=subprocess.STDOUT, text=True))
                time.sleep(0.1)
        attrs = [{'key': key, 'value': {'stringValue': value}} for key, value in {
            'service.name': 'preview-fixture', 'deployment.environment.name': 'staging',
            'preview.hostname': 'pr-999.c4-app-044.io.vn', 'preview.id': '999', 'service.version': 'wrong',
        }.items()]
        resource = {'attributes': attrs}
        now = str(time.time_ns())
        send('/v1/traces', {'resourceSpans': [{'resource': resource, 'scopeSpans': [{'spans': [{
            'traceId': '1' * 32, 'spanId': '2' * 16, 'name': 'preview-check',
            'startTimeUnixNano': now, 'endTimeUnixNano': str(int(now) + 1000),
            'attributes': [
                {'key': 'langfuse.observation.input', 'value': {'stringValue': 'private prompt'}},
                {'key': 'langfuse.observation.output', 'value': {'stringValue': 'private answer'}},
                {'key': 'url.full', 'value': {'stringValue': 'https://example.test/?api_key=secret&q=test'}},
            ],
        }]}]}]})
        send('/v1/logs', {'resourceLogs': [{'resource': resource, 'scopeLogs': [{'logRecords': [{
            'timeUnixNano': now, 'body': {'stringValue': 'preview-check'},
        }]}]}]})
        send('/v1/metrics', {'resourceMetrics': [{'resource': resource, 'scopeMetrics': [{'metrics': [{
            'name': 'preview_check', 'gauge': {'dataPoints': [{'timeUnixNano': now, 'asInt': '1'}]},
        }]}]}]})
        output = tmp_path / 'telemetry.json'
        found = {}
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if output.exists():
                for line in output.read_text().splitlines():
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    for signal in ('resourceSpans', 'resourceLogs', 'resourceMetrics'):
                        for group in payload.get(signal, []):
                            if signal == 'resourceSpans':
                                span = group['scopeSpans'][0]['spans'][0]
                                span_attrs = {a['key']: a['value'].get('stringValue') for a in span['attributes']}
                                assert 'langfuse.observation.input' not in span_attrs
                                assert 'langfuse.observation.output' not in span_attrs
                                assert span_attrs['url.full'] == 'https://example.test/?api_key=REDACTED&q=test'
                            found[signal] = {a['key']: a['value'].get('stringValue')
                                             for a in group['resource']['attributes']}
            if len(found) == 3:
                break
            time.sleep(0.1)
        assert len(found) == 3, subprocess.check_output(['docker', 'logs', container], stderr=subprocess.STDOUT, text=True)
        for attrs in found.values():
            if environment == 'preview':
                if preview_id is not None:
                    assert attrs['preview.id'] == preview_id
                else:
                    assert 'preview.id' not in attrs
                assert attrs['preview.hostname'] == hostname
            else:
                assert 'preview.id' not in attrs
                assert 'preview.hostname' not in attrs
            assert attrs['deployment.environment.name'] == environment
            assert attrs['service.version'] == 'a' * 40
            assert attrs['service.name'] == 'preview-fixture'
            assert 'environment' not in attrs
    finally:
        subprocess.run(['docker', 'rm', '-f', container], check=True, stdout=subprocess.DEVNULL)
