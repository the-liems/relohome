"""Shared deployment network isolation and observability query contracts."""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
def test_only_collector_explicitly_joins_ingestion_and_has_no_public_port():
    compose = yaml.safe_load((ROOT / 'compose.coolify.yaml').read_text())
    services = compose['services']
    assert {name for name, service in services.items() if 'networks' in service} == {'collector'}
    collector = services['collector']
    assert collector['networks'] == ['ingestion']
    assert not {'ports', 'expose', 'labels', 'network_mode'} & collector.keys()
    assert compose['volumes']['collector-queue'] is None
    assert all(not value or not (value.get('external') or value.get('name'))
               for value in compose['volumes'].values())
    for service in services.values():
        env = service.get('environment', {})
        if 'OTEL_SERVICE_NAME' in env:
            assert env['OTEL_EXPORTER_OTLP_ENDPOINT'] == 'http://${SERVICE_NAME_COLLECTOR}:4318'
            assert env['OTEL_DEPLOYMENT_ENVIRONMENT'] == '${OTEL_DEPLOYMENT_ENVIRONMENT:-staging}'
    assert services['web']['environment']['SIU_PUBLIC_BASE_URL'] == '${SERVICE_URL_WEB:?}'
    assert services['payments-mcp']['environment']['PAYMENT_REDIRECT_URL'] == '${SERVICE_URL_WEB:?}/'


def test_internal_service_dns_tracks_coolify_preview_names():
    services = yaml.safe_load((ROOT / 'compose.coolify.yaml').read_text())['services']
    for name, service in services.items():
        if 'OTEL_SERVICE_NAME' in service.get('environment', {}):
            assert service['environment']['OTEL_SERVICE_NAME'] == name
    assert services['web']['environment']['LIFEFLOW_API_BASE_URL'] == 'http://${SERVICE_NAME_BACKEND}:8000/api/v1'
    assert services['location']['environment']['POSTGRES_HOST'] == '${SERVICE_NAME_POSTGIS}'
    assert '@${SERVICE_NAME_MOVING_DB}:' in services['moving-api']['environment']['MOVING_DATABASE_URL']
    assert 'http://${SERVICE_NAME_HCM_DRIVING}:' in services['location']['environment']['OSRM_HCM_DRIVING_URL']


def test_collector_stamps_all_signals_including_its_own_metrics():
    definition = yaml.safe_load((ROOT / 'deploy/observability/collector.yaml').read_text())
    attrs = {a['key']: a.get('value') for a in definition['processors']['resource/environment']['attributes']}
    assert attrs['deployment.environment.name'] == '${env:OTEL_DEPLOYMENT_ENVIRONMENT}'
    assert 'environment' not in attrs
    for pipeline in definition['service']['pipelines'].values():
        assert pipeline['processors'].index('resource/environment') < pipeline['processors'].index('transform/preview')
    assert 'transform/redact' in definition['service']['pipelines']['traces/tempo']['processors']


def test_backend_labels_dashboard_and_alerts_separate_previews():
    cortex = yaml.safe_load((ROOT / 'deploy/observability/cortex.yaml').read_text())
    assert 'preview.id' in cortex['limits']['promote_resource_attributes']
    dashboard = json.loads((ROOT / 'deploy/observability/grafana/previews.json').read_text())
    for panel in dashboard['panels']:
        for target in panel.get('targets', []):
            assert 'deployment_environment_name="preview"' in target['expr']
            assert 'preview_id=~"$pr"' in target['expr']
    alerts = yaml.safe_load((ROOT / 'deploy/observability/grafana/alerts.yaml').read_text())
    for group in alerts['groups']:
        for rule in group['rules']:
            for data in rule['data']:
                if data['datasourceUid'] == 'cortex':
                    assert 'deployment_environment_name=~"staging|production"' in data['model']['expr']


def test_preview_publication_and_cleanup_guards():
    build = yaml.safe_load((ROOT / '.github/workflows/build-application-images.yml').read_text())['jobs']['build']
    push = next(step for step in build['steps'] if step.get('name') == 'Push image')
    assert 'github.event.pull_request.head.repo.full_name == github.repository' in push['if']
    assert "vars.COOLIFY_PREVIEWS_ENABLED == 'true'" in push['if']
    cleanup = yaml.load((ROOT / '.github/workflows/preview-cleanup.yml').read_text(), Loader=yaml.BaseLoader)
    assert cleanup['on']['pull_request_target']['types'] == ['closed']
    assert 'COOLIFY_PREVIEWS_ENABLED' not in cleanup['jobs']['cleanup']['if']
    assert all('uses' not in step for step in cleanup['jobs']['cleanup']['steps'])
