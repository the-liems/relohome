# syntax=docker/dockerfile:1
# Build with the repository root as the context.
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /web
COPY Frontend/package*.json ./
COPY Frontend/scripts ./scripts
RUN npm ci
COPY Frontend/ ./
RUN npm run build

FROM python:3.11-slim AS python-build
WORKDIR /app
RUN python -m venv /opt/venv
COPY requirements.txt ./
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim AS runtime
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --from=python-build /opt/venv /opt/venv
COPY src/ ./src/
COPY config/ ./config/
RUN useradd --uid 10001 --create-home appuser \
    && mkdir -p /app/data && chown appuser:appuser /app/data
USER appuser

COPY Frontend/__init__.py Frontend/server.py Frontend/store.py ./Frontend/
COPY --from=frontend-build /web/dist ./Frontend/dist
EXPOSE 8503
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8503/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "Frontend.server:app", "--host", "0.0.0.0", "--port", "8503", "--workers", "1"]
