#!/usr/bin/env bash
# Install job dependencies outside the persistent setup-python tool cache.
set -euo pipefail

venv=$(mktemp -d "${RUNNER_TEMP:?}/p044-python.XXXXXX")
# Record ownership before creating the environment so failed creation is cleaned.
echo "CI_PYTHON_VENV=$venv" >> "${GITHUB_ENV:?}"
python -m venv "$venv"
echo "$venv/bin" >> "${GITHUB_PATH:?}"
