#!/usr/bin/env bash
# Verify capabilities in the job itself; never install or change the runner host.
set -euo pipefail

fail() { echo "$*" >&2; exit 1; }
require_tool() { command -v "$1" || fail "Missing required tool: $1"; }

test "$(uname -s)" = Linux || fail "CI requires Linux, found $(uname -s)"
case "$(uname -m)" in
  aarch64|x86_64) ;;
  *) fail "CI requires Linux ARM64 or x64, found $(uname -m)" ;;
esac
echo "Runner: $(uname -s)/$(uname -m)"
for tool in bash git; do require_tool "$tool"; done

for capability in "$@"; do
  case "$capability" in
    python)
      require_tool python
      python --version
      python -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 11) else "Python 3.11 required, found " + sys.version.split()[0])'
      python -m pip --version
      ;;
    node|node22)
      require_tool node
      require_tool npm
      node --version
      expected=24
      if [ "$capability" = node22 ]; then expected=22; fi
      test "$(node -p 'process.versions.node.split(".")[0]')" = "$expected" || fail "Node.js $expected required, found $(node --version)"
      npm --version
      ;;
    docker)
      require_tool docker
      docker version
      docker info >/dev/null
      ;;
    mcp)
      for tool in make awk basename dirname xargs; do require_tool "$tool"; done
      docker buildx version || fail "Docker Buildx is required for MCP image builds"
      ;;
    buildx)
      docker buildx version || fail "Docker Buildx is required for image builds"
      ;;
    compose)
      require_tool openssl
      openssl version
      docker compose version
      version=$(docker compose version --short)
      version=${version#v}
      # !override in the CI overlay requires Compose >= 2.24.4.
      core=${version%%-*}
      [[ "$core" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Unrecognized Docker Compose version: $version"
      IFS=. read -r major minor patch <<< "$core"
      if (( 10#$major < 2 || (10#$major == 2 && (10#$minor < 24 || (10#$minor == 24 && 10#$patch < 4))) )); then
        fail "Docker Compose >= 2.24.4 required, found $version"
      fi
      ;;
    *) fail "Unknown capability: $capability" ;;
  esac
done
