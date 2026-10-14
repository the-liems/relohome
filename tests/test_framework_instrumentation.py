"""Official integrations provide one HTTP span and preserve policy/privacy boundaries."""

import json
import os

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from opentelemetry import trace
from relohome_observability.asgi import instrument_fastapi, instrument_starlette, uninstrument_http
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from tests.test_observability_http_errors import observed as observed


@pytest.mark.asyncio
async def test_fastapi_automatic_errors_routes_exclusions_and_idempotency(observed):
    app = FastAPI(telemetry={"tracing": False})
    instrument_fastapi(app, trust_incoming=False)
    instrument_fastapi(app, trust_incoming=False)

    @app.get("/items/{item_id}")
    async def item(item_id: str):
        raise ValueError("SYNTHETIC_PRIVATE_EXCEPTION person@example.com")

    @app.get("/handled")
    async def handled():
        raise HTTPException(503, "SYNTHETIC_PRIVATE_DETAIL")

    @app.get("/health")
    async def health():
        return {"ok": True}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url="http://test") as client:
        # Even an ambient caller span and an unsampled browser parent cannot
        # choose the public gateway's trace or sampling policy.
        with trace.get_tracer("test").start_as_current_span("ambient") as ambient:
            response = await client.get("/items/SYNTHETIC_PRIVATE_ID?token=SYNTHETIC_PRIVATE_TOKEN", headers={
                "traceparent": "00-11111111111111111111111111111111-2222222222222222-00",
                "authorization": "Bearer SYNTHETIC_PRIVATE_SECRET", "baggage": "user=SYNTHETIC_PRIVATE_USER",
            })
            assert response.status_code == 500
            span = observed.spans.get_finished_spans()[0]
            assert span.parent is None
            assert span.context.trace_id != ambient.get_span_context().trace_id
            assert response.headers["x-trace-id"] == format(span.context.trace_id, "032x")
            assert trace.get_current_span().get_span_context() == ambient.get_span_context()
        spans = [span for span in observed.spans.get_finished_spans() if span.kind == trace.SpanKind.SERVER]
        assert len(spans) == 1
        assert spans[0].instrumentation_scope.name == "opentelemetry.instrumentation.fastapi"
        assert spans[0].name == "GET /items/{item_id}"
        assert spans[0].attributes["error.type"].endswith("ValueError")
        assert spans[0].attributes["http.response.status_code"] == 500
        assert not spans[0].events and spans[0].status.description is None
        assert "SYNTHETIC_PRIVATE" not in json.dumps(dict(spans[0].attributes))
        observed.spans.clear()
        assert (await client.get("/handled")).status_code == 503
        assert observed.spans.get_finished_spans()[0].attributes["error.type"] == "503"
        observed.spans.clear()
        assert (await client.get("/SYNTHETIC_PRIVATE_UNKNOWN")).status_code == 404
        assert observed.spans.get_finished_spans()[0].name == "GET unmatched"
        observed.spans.clear()
        for path in ("/health", "/assets/SYNTHETIC_PRIVATE_ASSET", "/images/SYNTHETIC_PRIVATE_IMAGE"):
            assert "x-trace-id" not in (await client.get(path)).headers
        assert not observed.spans.get_finished_spans()
    uninstrument_http(app)


def test_psycopg_pool_uses_official_instrumentation_with_safe_query_errors(observed):
    import psycopg
    from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
    from psycopg_pool import ConnectionPool

    url = os.getenv("ROOMMATE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires the dedicated PostgreSQL test database used by CI")
    instrumentor = PsycopgInstrumentor()
    instrumentor.instrument(tracer_provider=trace.get_tracer_provider(), capture_parameters=False, enable_commenter=False)
    try:
        with ConnectionPool(url, min_size=1, max_size=2) as pool:
            pool.wait(timeout=10)
            with pool.connection() as connection:
                assert isinstance(connection, psycopg.Connection)
                connection.execute("SELECT 1")  # An idle probe has no request parent.
                assert not observed.spans.get_finished_spans()
                with trace.get_tracer("test").start_as_current_span("database.request"):
                    with connection.transaction():
                        assert connection.execute("SELECT %s::text", ("SYNTHETIC_PRIVATE_PG_VALUE",)).fetchone() == (
                            "SYNTHETIC_PRIVATE_PG_VALUE",
                        )
                    with pytest.raises(psycopg.errors.UndefinedTable), connection.transaction():
                        connection.execute("SELECT * FROM SYNTHETIC_PRIVATE_MISSING_TABLE")
                assert connection.execute("SELECT 1").fetchone() == (1,)  # Pool/rollback behavior is preserved.
        spans = observed.spans.get_finished_spans()
        root = next(span for span in spans if span.name == "database.request")
        queries = [span for span in spans if span.attributes.get("db.system") == "postgresql"]
        assert len(queries) == 2
        assert all(span.instrumentation_scope.name == "opentelemetry.instrumentation.psycopg" for span in queries)
        assert all(span.parent.span_id == root.context.span_id and span.context.trace_id == root.context.trace_id
                   for span in queries)
        assert queries[-1].status.status_code == trace.StatusCode.ERROR
        assert queries[-1].attributes["error.type"].endswith("UndefinedTable")
        assert "SYNTHETIC_PRIVATE" not in json.dumps([dict(span.attributes) for span in spans])
        assert all(not span.events and span.status.description is None for span in spans)
    finally:
        instrumentor.uninstrument()


@pytest.mark.asyncio
async def test_starlette_uses_official_route_instrumentation_and_trusted_parent(observed):
    async def item(request):
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/items/{item_id}", item), Route("/health", item)])
    instrument_starlette(app)
    instrument_starlette(app)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/items/SYNTHETIC_PRIVATE_ID", headers={
            "traceparent": "00-11111111111111111111111111111111-2222222222222222-01",
        })
        assert response.status_code == 200
        assert response.headers["x-trace-id"] == "1" * 32
        assert "x-trace-id" not in (await client.get("/health")).headers
    spans = observed.spans.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].instrumentation_scope.name == "opentelemetry.instrumentation.starlette"
    assert spans[0].name == "GET /items/{item_id}"
    assert spans[0].parent.span_id == int("2" * 16, 16)
    assert "SYNTHETIC_PRIVATE" not in json.dumps(dict(spans[0].attributes))
    uninstrument_http(app)


@pytest.mark.asyncio
async def test_starlette_unhandled_error_has_status_and_original_exception_type(observed):
    async def failure(request):
        raise ValueError("SYNTHETIC_PRIVATE_EXCEPTION")

    app = Starlette(routes=[Route("/failure", failure)])
    instrument_starlette(app)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url="http://test") as client:
        response = await client.get("/failure")
    assert response.status_code == 500
    spans = observed.spans.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].attributes["http.response.status_code"] == 500
    assert spans[0].attributes["error.type"].endswith("ValueError")
    assert response.headers["x-trace-id"] == format(spans[0].context.trace_id, "032x")
    assert "SYNTHETIC_PRIVATE" not in json.dumps(dict(spans[0].attributes))
    assert not spans[0].events
    uninstrument_http(app)


@pytest.mark.asyncio
async def test_disabled_boundary_bypasses_official_tracing_and_restores_context(monkeypatch, observed):
    app = FastAPI(telemetry={"tracing": False})
    instrument_fastapi(app, trust_incoming=False)

    @app.get("/item")
    async def item():
        return {"ok": True}

    monkeypatch.setenv("OBSERVABILITY_ENABLED", "false")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/item")
    assert response.status_code == 200 and "x-trace-id" not in response.headers
    assert not observed.spans.get_finished_spans()
    assert not observed.logs.get_finished_logs()
    uninstrument_http(app)


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["intake", "orchestrator"])
async def test_additional_fastapi_services_are_instrumented_without_provider_calls(monkeypatch, observed, service):
    from relohome_agent_services.common import ServiceSettings

    if service == "intake":
        from relohome_intake.app import create_app
        path, method = "/v1/intake", "POST"
    else:
        from relohome_orchestrator.app import create_app
        path, method = "/v1/capabilities", "GET"
    settings = ServiceSettings(orchestrator_db_path=":memory:")
    app = create_app(settings)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(method, path)
    assert response.status_code == 503  # Missing service token; no LLM/provider call.
    spans = observed.spans.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].instrumentation_scope.name == "opentelemetry.instrumentation.fastapi"
    assert spans[0].attributes["http.route"] == path
    assert spans[0].attributes["http.response.status_code"] == 503
    assert spans[0].attributes["error.type"] == "missing_service_token"
    assert response.headers["x-trace-id"] == format(spans[0].context.trace_id, "032x")
    uninstrument_http(app)
