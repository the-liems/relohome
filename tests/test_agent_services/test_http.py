"""Requests go through the real ASGI apps; nothing is mocked or patched."""

import secrets
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr
from relohome_intake.app import create_app as intake_app
from relohome_orchestrator.app import create_app as orchestrator_app

from src.agent_services.common import ServiceSettings
from tests.test_agent_services.test_contracts import catalog_task, draft


def settings(tmp_path):
    return ServiceSettings(
        _env_file=None,
        openai_api_key=SecretStr(""),
        intake_api_token=SecretStr(secrets.token_urlsafe(32)),
        orchestrator_api_token=SecretStr(secrets.token_urlsafe(32)),
        orchestrator_approval_token=SecretStr(secrets.token_urlsafe(32)),
        orchestrator_db_path=str(tmp_path / "http.sqlite3"),
    )


def test_intake_auth_liveness_and_missing_real_key(tmp_path):
    config = settings(tmp_path)
    with TestClient(intake_app(config)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == 503
        body = {"request_id": str(uuid4()), "session_id": "http-contract", "message": "Xem khu vực phục vụ"}
        assert client.post("/v1/intake", json=body).status_code == 401
        headers = {"Authorization": "Bearer " + config.intake_api_token.get_secret_value()}
        response = client.post("/v1/intake", headers=headers, json=body)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "LLM_NOT_CONFIGURED"
        assert response.headers["X-Request-ID"]
        assert "understanding" not in response.json()


def test_orchestrator_contract_endpoint_and_auth_boundaries(tmp_path):
    config = settings(tmp_path)
    with TestClient(orchestrator_app(config)) as client:
        ready = client.get("/ready").json()
        assert ready["execution"] == "disconnected"
        assert ready["planning"] == "llm_not_configured"
        assert client.get("/v1/capabilities").status_code == 401
        headers = {"Authorization": "Bearer " + config.orchestrator_api_token.get_secret_value()}
        response = client.post("/v1/plans/validate", headers=headers, json=draft(catalog_task()).model_dump())
        assert response.status_code == 200
        assert response.json()["execution"] == "not_performed"
        # General caller cannot submit approvals; checks authentication before body validation.
        approval_url = f"/v1/workflows/{uuid4()}/tasks/a/approve"
        response = client.post(approval_url, headers=headers, json={})
        assert response.status_code == 401


def test_http_limits_and_validation_do_not_echo_secrets(tmp_path):
    config = settings(tmp_path)
    config.agent_max_body_bytes = 1024
    with TestClient(intake_app(config)) as client:
        headers = {"Authorization": "Bearer " + config.intake_api_token.get_secret_value()}
        assert client.post("/v1/intake", headers=headers, content="a" * 1025).status_code == 413
        response = client.post("/v1/intake", headers=headers, json={"message": "private-user-content"})
        assert response.status_code == 422
        assert "private-user-content" not in response.text
