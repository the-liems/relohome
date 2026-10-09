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

for dockerfile in src/mcp_servers/*/Dockerfile; do
  server=$(basename "$(dirname "$dockerfile")")
  port=$(awk '/^EXPOSE/ {print $2; exit}' "$dockerfile")
  container="$server-mcp-smoke-$suffix"
  # Register before starting: docker run may create a container and then fail.
  containers+=("$container")
  docker run -d --name "$container" --label "lifeflow.ci.mcp=$tag" "$server-mcp:$tag"
  # Probe the service's health endpoint without relying on image health metadata.
  probe_health() {
    docker exec "$container" python -c '
import sys
from urllib.request import urlopen

with urlopen(f"http://127.0.0.1:{sys.argv[1]}/health", timeout=10) as response:
    print(response.read().decode())
' "$port"
  }
  healthy=false
  for (( i=0; i<30; i++ )); do
    if probe_health >/dev/null 2>&1; then
      healthy=true
      break
    fi
    sleep 2
  done
  if [ "$healthy" != true ]; then
    echo "Container $container did not become healthy" >&2
    exit 1
  fi
  probe_health
  echo
done
