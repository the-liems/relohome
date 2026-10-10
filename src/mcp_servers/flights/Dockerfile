# syntax=docker/dockerfile:1.14
# MCP server đặt vé máy bay nội địa (vn-flight-booking) — Streamable HTTP tại :8765/mcp
#
# Build context là THƯ MỤC GỐC dự án vì code import theo package `src.mcp_servers.flights`:
#   docker build -f src/mcp_servers/flights/Dockerfile -t flights-mcp .
#   docker run --rm -p 8765:8765 -e FLIGHT_SEARCH_PROVIDER=mock flights-mcp

# ---- Stage 1: cài dependency vào virtualenv riêng ----
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY src/mcp_servers/flights/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

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

# Chỉ copy đúng package của server (không copy .env, tests, code agent...)
COPY --chmod=u=rwX,go=rX src/__init__.py src/__init__.py
COPY --chmod=u=rwX,go=rX src/mcp_servers/__init__.py src/mcp_servers/__init__.py
COPY --chmod=u=rwX,go=rX src/mcp_servers/http_service.py src/mcp_servers/http_service.py
COPY --chmod=u=rwX,go=rX src/mcp_servers/flights src/mcp_servers/flights

# Chạy bằng user thường; SQLite (offer, booking) nằm trong volume /app/data
RUN useradd --create-home --uid 10001 mcp \
    && mkdir -p /app/data \
    && chown -R mcp:mcp /app/data
USER mcp
VOLUME ["/app/data"]

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['FLIGHT_MCP_PORT']}/health\", timeout=4)" || exit 1

CMD ["python", "-m", "src.mcp_servers.flights", "--transport", "streamable-http"]
