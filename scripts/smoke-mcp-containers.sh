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
  healthy=false
  for (( i=0; i<30; i++ )); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = healthy ]; then
      healthy=true
      break
    fi
    sleep 2
  done
  if [ "$healthy" != true ]; then
    echo "Container $container did not become healthy" >&2
    exit 1
  fi
  # The runner may itself be a container using a host Docker socket. Its
  # localhost is then not the daemon's localhost. Probe the service's network
  # address so a server bound only to loopback still fails the smoke test.
  docker exec "$container" python -c 'import socket, sys, urllib.request; ip = socket.gethostbyname(socket.gethostname()); print(urllib.request.urlopen(f"http://{ip}:{sys.argv[1]}/health", timeout=10).read().decode())' "$port"
  echo
done
