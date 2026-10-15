# syntax=docker/dockerfile:1.14
# MCP server thanh toán (vn-payment) — Streamable HTTP tại :8766/mcp
#
# Build context là THƯ MỤC GỐC dự án vì code import theo package `relohome_payments_mcp`:
#   docker build -f apps/payments-mcp/Dockerfile -t payments-mcp .
#   docker run --rm -p 8766:8766 payments-mcp                     # mock, không cần key
#   docker run --rm -p 8766:8766 --env-file .env payments-mcp     # ZaloPay: key chỉ truyền lúc chạy
# Image KHÔNG chứa key hay .env (xem ADR-015).

# ---- Stage 1: cài dependency vào virtualenv riêng ----
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY apps/payments-mcp/requirements.txt /tmp/requirements.txt
COPY packages/python/payment/ /build/domain/
COPY requirements-observability.txt /tmp/requirements-observability.txt
COPY packages/python/mcp-http/ /build/mcp-http/
COPY apps/payments-mcp/ /build/app/
RUN pip install -r /tmp/requirements.txt -r /tmp/requirements-observability.txt /build/domain /build/mcp-http /build/app

# ---- Stage 2: runtime ----
FROM python:3.11-slim

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PAYMENT_PROVIDER=mock \
    PAYMENT_DB_PATH=/app/data/payments.db \
    PAYMENT_MCP_HOST=0.0.0.0 \
    PAYMENT_MCP_PORT=8766

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv

# Runtime uses installed wheels only; no checkout source is copied.

# Chạy bằng user thường; SQLite (giao dịch + muối giả danh) nằm trong volume /app/data
RUN useradd --create-home --uid 10001 mcp \
    && mkdir -p /app/data \
    && chown -R mcp:mcp /app/data
USER mcp
VOLUME ["/app/data"]

EXPOSE 8766

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['PAYMENT_MCP_PORT']}/health\", timeout=4)" || exit 1

ENV OTEL_SEMCONV_STABILITY_OPT_IN=http OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf OTEL_PROPAGATORS=tracecontext
ENV OTEL_PYTHON_EXCLUDED_URLS="/(healthz?|readyz?|metrics)(\\?.*)?$|/(assets|images)/"
ENV OTEL_RESOURCE_ATTRIBUTES=service.namespace=relohome
ENV OTEL_SERVICE_NAME=payments-mcp
CMD ["opentelemetry-instrument", "python", "-m", "relohome_payments_mcp", "--transport", "streamable-http"]
