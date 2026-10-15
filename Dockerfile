# syntax=docker/dockerfile:1.14
FROM python:3.11-slim AS python-build
ENV RELOHOME_RUNTIME_ROOT=/app
WORKDIR /app
RUN python -m venv /opt/venv
COPY requirements-runtime.txt requirements-observability.txt ./
COPY packages/python/ ./packages/python/
COPY apps/agent-api/ ./apps/agent-api/
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements-runtime.txt -r requirements-observability.txt \
    ./packages/python/privacy ./packages/python/contracts ./packages/python/roommate ./packages/python/flight ./apps/agent-api

FROM python:3.11-slim AS runtime
ENV OTEL_SEMCONV_STABILITY_OPT_IN=http OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf OTEL_PROPAGATORS=tracecontext
ENV OTEL_PYTHON_EXCLUDED_URLS="/(healthz?|readyz?|metrics)(\\?.*)?$|/(assets|images)/"
ENV OTEL_RESOURCE_ATTRIBUTES=service.namespace=relohome
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENV RELOHOME_RUNTIME_ROOT=/app
WORKDIR /app
COPY --from=python-build /opt/venv /opt/venv
ENV OTEL_SERVICE_NAME=backend
COPY --chmod=u=rwX,go=rX config/ ./config/
# /app/private-roommate: Roommate DB and contact key, private to the service user (runbook: roommate).
RUN useradd --uid 10001 --create-home appuser \
    && mkdir -p /app/data /app/private-roommate \
    && chown appuser:appuser /app/data /app/private-roommate \
    && chmod 700 /app/private-roommate
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["opentelemetry-instrument", "python", "-m", "uvicorn", "relohome_agent.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
