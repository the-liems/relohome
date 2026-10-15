# syntax=docker/dockerfile:1.14
# MCP server đặt vé máy bay nội địa (vn-flight-booking) — Streamable HTTP tại :8765/mcp
#
# Build context là THƯ MỤC GỐC dự án vì code import theo package `relohome_flights_mcp`:
#   docker build -f apps/flights-mcp/Dockerfile -t flights-mcp .
#   docker run --rm -p 8765:8765 -e FLIGHT_SEARCH_PROVIDER=mock flights-mcp

# ---- Stage 1: cài dependency vào virtualenv riêng ----
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY apps/flights-mcp/requirements.txt /tmp/requirements.txt
COPY packages/python/flight/ /build/domain/
COPY requirements-observability.txt /tmp/requirements-observability.txt
COPY packages/python/mcp-http/ /build/mcp-http/
COPY apps/flights-mcp/ /build/app/
RUN pip install -r /tmp/requirements.txt -r /tmp/requirements-observability.txt /build/domain /build/mcp-http /build/app

# ---- Stage 2: runtime ----
FROM python:3.11-slim

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLIGHT_SEARCH_PROVIDER=mock \
    FLIGHT_DB_PATH=/app/data/flights.db \
    FLIGHT_MCP_HOST=0.0.0.0 \
    FLIGHT_MCP_PORT=8765

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv

# Runtime uses installed wheels only; no checkout source is copied.

# Chạy bằng user thường; SQLite (offer, booking) nằm trong volume /app/data
RUN useradd --create-home --uid 10001 mcp \
    && mkdir -p /app/data \
    && chown -R mcp:mcp /app/data
USER mcp
VOLUME ["/app/data"]

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['FLIGHT_MCP_PORT']}/health\", timeout=4)" || exit 1

ENV OTEL_SEMCONV_STABILITY_OPT_IN=http OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf OTEL_PROPAGATORS=tracecontext
ENV OTEL_PYTHON_EXCLUDED_URLS="/(healthz?|readyz?|metrics)(\\?.*)?$|/(assets|images)/"
ENV OTEL_RESOURCE_ATTRIBUTES=service.namespace=relohome
ENV OTEL_SERVICE_NAME=flights-mcp
CMD ["opentelemetry-instrument", "python", "-m", "relohome_flights_mcp", "--transport", "streamable-http"]
