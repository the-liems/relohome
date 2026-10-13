#!/usr/bin/env bash
# Run-scoped images, containers and anonymous volumes. No host ports required.
set -euo pipefail

tag=${MCP_IMAGE_TAG:-latest}
suffix=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$
containers=()
cleanup() {
  status=$?
  trap - EXIT INT TERM
  for container in "${containers[@]}"; do
    if (( status != 0 )); then docker logs --tail 100 "$container" || true; fi
    docker rm -fv "$container" >/dev/null || true
  done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

probe_health() {
  docker exec "$1" python -c '
import os
import sys
from urllib.request import urlopen

assert os.geteuid() != 0, "MCP image must use its non-root USER"
with urlopen(f"http://127.0.0.1:{sys.argv[1]}/health", timeout=2) as response:
    print(response.read().decode())
' "$2"
}

for project in apps/*-mcp/pyproject.toml; do
  dockerfile="${project%/pyproject.toml}/Dockerfile"
  server=$(basename "$(dirname "$dockerfile")" -mcp)
  port=$(awk '/^EXPOSE/ {print $2; exit}' "$dockerfile")
  container="$server-mcp-smoke-$suffix"
  # Register before starting: docker run may create a container and then fail.
  containers+=("$container")
  docker run -d --network none --env "MCP_AUTH_TOKEN=smoke-$suffix-01234567890123456789012345678901" --name "$container" --label "lifeflow.ci.mcp=$tag" "$server-mcp:$tag"
  # Probe the service's health endpoint without relying on image health metadata.
  healthy=false
  probe_result=''
  for (( i=0; i<30; i++ )); do
    if probe_result=$(probe_health "$container" "$port" 2>&1); then
      healthy=true
      break
    fi
    sleep 2
  done
  if [ "$healthy" != true ]; then
    echo "Container $container did not become healthy" >&2
    echo "Last /health probe error: $probe_result" >&2
    exit 1
  fi
  docker exec -i --workdir /tmp "$container" python \
    -I - "$server-mcp" --require-nonroot < scripts/check-python-install.py
  printf '%s\n' "$probe_result"
  echo
done
