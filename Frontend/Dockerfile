# syntax=docker/dockerfile:1.14
# Build with the repository root as the context.
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /web
COPY package.json package-lock.json ./
COPY Frontend/package.json ./Frontend/package.json
COPY Frontend/scripts ./Frontend/scripts
RUN npm ci --workspace Frontend --include-workspace-root=false
COPY Frontend/ ./Frontend/
RUN npm run build --workspace Frontend

FROM python:3.11-slim AS python-build
WORKDIR /app
RUN python -m venv /opt/venv
COPY requirements.txt ./
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim AS runtime
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --from=python-build /opt/venv /opt/venv
COPY --chmod=u=rwX,go=rX src/ ./src/
COPY --chmod=u=rwX,go=rX config/ ./config/
RUN useradd --uid 10001 --create-home appuser \
    && mkdir -p /app/data && chown appuser:appuser /app/data
# Every top-level gateway module (server, store, roommate_gateway, ...); tests check imports resolve.
COPY --chmod=u=rwX,go=rX Frontend/*.py ./Frontend/
COPY --chmod=u=rwX,go=rX --from=frontend-build /web/Frontend/dist ./Frontend/dist
USER appuser
EXPOSE 8503
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8503/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "Frontend.server:app", "--host", "0.0.0.0", "--port", "8503", "--workers", "1"]
