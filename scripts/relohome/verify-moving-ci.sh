#!/usr/bin/env bash
# Probe both real services on the Compose network, even from a container runner.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."

image=${NODE_IMAGE:-$(awk -F= '/^ARG NODE_IMAGE=/ {print $2; exit}' deploy/moving/Dockerfile.moving)}
test -n "$image" || { echo 'Dockerfile.moving must declare NODE_IMAGE' >&2; exit 1; }

project=${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME}
container="$project-verify"
network="${project}_default"
case "${1:-}" in
  '') ;;
  --check-imports) network=none ;;
  *) echo 'Expected no arguments or --check-imports' >&2; exit 1 ;;
esac
cleanup() {
  status=$?
  trap - EXIT INT TERM
  docker rm -fv "$container" >/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker create --name "$container" --network "$network" \
  --label "lifeflow.ci.moving=$project" --workdir /workspace \
  -e MOVING_MCP_AUTH_TOKEN -e RELEASE_SHA \
  -e MOVING_MCP_URL=http://moving-mcp:4400/mcp \
  -e MOVING_API_URL=http://moving-api:4200 \
  "$image" sleep infinity
docker start "$container"
# Docker bind mounts resolve on the daemon host, not the runner. Copy only the
# verifier and its built dependencies; do not copy .env files or local data.
docker cp package.json "$container:/workspace/package.json"
docker cp node_modules "$container:/workspace/node_modules"
docker exec "$container" mkdir -p '/workspace/scripts'
docker cp packages "$container:/workspace/packages"
docker cp scripts/relohome "$container:/workspace/scripts/relohome"
if [ "${1:-}" = --check-imports ]; then
  # Exercise copying and dependency resolution without any provider/network call.
  docker exec "$container" node --input-type=module -e "await import('@modelcontextprotocol/client'); await import('@relohome/moving-service')"
else
  docker exec --workdir /workspace "$container" node scripts/relohome/verify-moving-deployment.mjs
fi
