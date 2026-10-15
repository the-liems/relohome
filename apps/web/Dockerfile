# syntax=docker/dockerfile:1.14
# Combined browser + gateway image; repository root build context.
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /web
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/scripts ./apps/web/scripts
# Verify the native bundler before caching a successful dependency layer: npm can
# report success after a network failure fetching an optional platform binding.
RUN npm ci --workspace apps/web --include-workspace-root=false --fetch-timeout=900000 \
    && npm exec --offline --workspace apps/web -- vite --version
COPY apps/web/ ./apps/web/
RUN npm run build --workspace apps/web

FROM python:3.11-slim AS python-build
# Build isolation subprocesses inherit the same registry read timeout.
ENV PIP_DEFAULT_TIMEOUT=120
WORKDIR /app
RUN python -m venv /opt/venv
COPY requirements-runtime.txt requirements-observability.txt ./
COPY packages/python/ ./packages/python/
COPY apps/browser-gateway/ ./apps/browser-gateway/
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements-runtime.txt -r requirements-observability.txt \
    ./packages/python/privacy ./packages/python/contracts ./packages/python/roommate ./packages/python/flight ./apps/browser-gateway

FROM python:3.11-slim AS runtime
ENV OTEL_SEMCONV_STABILITY_OPT_IN=http OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf OTEL_PROPAGATORS=tracecontext
ENV OTEL_PYTHON_EXCLUDED_URLS="/(healthz?|readyz?|metrics)(\\?.*)?$|/(assets|images)/"
ENV OTEL_RESOURCE_ATTRIBUTES=service.namespace=relohome
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
ENV RELOHOME_RUNTIME_ROOT=/app
WORKDIR /app
COPY --from=python-build /opt/venv /opt/venv
ENV OTEL_SERVICE_NAME=web
RUN useradd --uid 10001 --create-home appuser \
    && mkdir -p /app/data && chown appuser:appuser /app/data
COPY --chmod=u=rwX,go=rX --from=frontend-build /web/apps/web/dist ./apps/web/dist
USER appuser
EXPOSE 8503
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8503/health', timeout=4)"
CMD ["opentelemetry-instrument", "python", "-m", "uvicorn", "relohome_gateway.server:app", "--host", "0.0.0.0", "--port", "8503", "--workers", "1"]
