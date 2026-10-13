# syntax=docker/dockerfile:1.14
# MCP server thanh toán (vn-payment) — Streamable HTTP tại :8766/mcp
#
# Build context là THƯ MỤC GỐC dự án vì code import theo package `src.mcp_servers.payments`:
#   docker build -f src/mcp_servers/payments/Dockerfile -t payments-mcp .
#   docker run --rm -p 8766:8766 payments-mcp                     # mock, không cần key
#   docker run --rm -p 8766:8766 --env-file .env payments-mcp     # ZaloPay: key chỉ truyền lúc chạy
# Image KHÔNG chứa key hay .env (xem ADR-015).

# ---- Stage 1: cài dependency vào virtualenv riêng ----
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY src/mcp_servers/payments/requirements.txt /tmp/requirements.txt
COPY packages/python/payment/ /build/domain/
COPY packages/python/observability/ /build/observability/
COPY packages/python/mcp-http/ /build/mcp-http/
COPY src/mcp_servers/payments/ /build/app/
RUN pip install -r /tmp/requirements.txt /build/observability /build/domain /build/mcp-http /build/app

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

# Chỉ copy đúng package của server (không copy .env, tests, code agent...)
COPY --chmod=u=rwX,go=rX src/__init__.py src/__init__.py
COPY --chmod=u=rwX,go=rX src/mcp_servers/__init__.py src/mcp_servers/__init__.py
COPY --chmod=u=rwX,go=rX src/mcp_servers/http_service.py src/mcp_servers/http_service.py
COPY --chmod=u=rwX,go=rX src/mcp_servers/payments src/mcp_servers/payments

# Chạy bằng user thường; SQLite (giao dịch + muối giả danh) nằm trong volume /app/data
RUN useradd --create-home --uid 10001 mcp \
    && mkdir -p /app/data \
    && chown -R mcp:mcp /app/data
USER mcp
VOLUME ["/app/data"]

EXPOSE 8766

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['PAYMENT_MCP_PORT']}/health\", timeout=4)" || exit 1

CMD ["python", "-m", "src.mcp_servers.payments", "--transport", "streamable-http"]
