# Self-hosted CI

All jobs in `ci.yml`, `moving-containers.yml`, `agent-services.yml`,
`map-data.yml`, and `mvp.yml` use `[self-hosted, linux, team-44]`. The runner
must be available to this repository and carry all three labels. Job/check
names, existing path filters, dependencies, GHCR push conditions, and the protected
`moving-staging` environment remain unchanged.
Agent and Map workflows also watch the shared runner preflight; Moving change
detection requests validation when it changes. Agent CI watches the Python
environment helper too.

The baseline CI run on 2026-10-05 used `team-44-Doan0904`, Linux ARM64.
Both Linux ARM64 and x64 are supported; no job needs x64 emulation. Container
builds use the runner's native architecture, as before. A successful ARM64
build is not evidence of an amd64 release image.

| Jobs | Required tools |
| --- | --- |
| Every job | Bash and Git |
| Python CI, agent services, map data, MVP | Python 3.11 and pip, provided by `actions/setup-python` |
| LifeFlow, Moving validation/staging, agent services | Node.js 24 and npm, provided by `actions/setup-node` |
| MVP | Node.js 22 and npm (existing workspace validation version) |
| MCP images, agent services, Moving validation/images/staging | Docker CLI and access to a running Linux Docker daemon |
| MCP images | Make, awk, basename, dirname, xargs |
| Moving validation/staging | OpenSSL and Docker Compose >= 2.24.4 (`!override` ports) |
| Moving images | Docker Buildx, provided by `docker/setup-buildx-action` |

`scripts/check-ci-runner.sh` checks tools inside jobs before expensive work.
The setup actions verify language runtimes; job logs record actual versions
and Docker access. The runner also needs outbound access to GitHub Actions,
language package registries, Docker Hub, and (for main pushes) GHCR.
All jobs have a 30-minute execution timeout.
Python jobs that install dependencies create a fresh virtualenv in `RUNNER_TEMP`
and remove it with `always()`. Packages never install into the shared interpreter.

## Disposable resources

- MCP and agent smoke jobs build images tagged by run ID and attempt, use
  unique container names without publishing host ports, and remove
  containers including anonymous volumes. Smoke scripts clean up on failure
  and termination. An `always()` step uses a job-specific container label as
  a cancellation fallback and removes only that job's image tags.
- Moving staging uses `moving-ci-<run-id>-<attempt>` as the Compose project.
  The CI overlay assigns matching image tags, random loopback ports, and a
  project-scoped database volume. `always()` steps collect diagnostics,
  remove that project's containers/networks/volumes, and delete its image tags.
- HTTP smoke probes use `docker exec` against each service's non-loopback network
  address, preserving detection of an image that listens only on localhost. Moving's
  existing read-only deployment verifier runs in a disposable Node container
  on the Compose network. This supports runners using a host Docker socket:
  runner loopback and filesystem paths need not match the daemon host.
  Moving validation exercises the same verifier container and dependency copy
  with `--check-imports` on a disabled network, without invoking the provider.
- Never use a global Docker prune on a shared runner. Docker/BuildKit caches
  and downloaded base images are reusable host resources.

Real staging verification still requires explicit `workflow_dispatch` with
`verify_staging=true`, environment approval, and actual provider credentials.
Ordinary PR validation does not call the live provider or publish GHCR images.

## Verification

Run `actionlint` (the custom label is configured in `.github/actionlint.yaml`),
`bash -n scripts/check-ci-runner.sh scripts/setup-ci-python.sh scripts/smoke-mcp-containers.sh`, and
`python -m unittest discover -s tests -p 'test_ci_*.py'`.
The smoke regression tests exercise failed starts, health timeouts, failed
HTTP checks, cleanup, and overlapping run isolation using a fake Docker CLI.
Runner tests cover the Compose minimum-version boundary, diagnostic messages,
capability-specific prerequisites, and fresh Python environment creation.
Actual container compatibility and runner availability must additionally be
verified in Actions. Python assertion fixes are tracked separately in #45–#50.
