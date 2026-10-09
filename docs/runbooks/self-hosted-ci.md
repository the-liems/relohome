# Self-hosted CI

All jobs in `ci.yml`, `moving-containers.yml`, `agent-services.yml`,
`map-data.yml`, `mvp.yml`, `postgis-image.yml`, and `deploy-staging.yml` use `[self-hosted, linux, team-44]`. The runner
must be available to this repository and carry all three labels. Job/check
names, existing path filters, dependencies, GHCR push conditions, and the protected
`moving-staging` environment remain unchanged.
Agent and Map workflows also watch the shared runner preflight; Moving change
detection requests validation when it changes. Agent CI watches the Python
environment helper too.

The baseline CI run on 2026-10-05 used `team-44-Doan0904`, Linux ARM64.
Most checks support Linux ARM64 and x64. The application-image matrix and PostGIS
publisher build ARM64 images and use the ARM64 runner. A successful ARM64 build
is not evidence of an amd64 release image.

| Jobs | Required tools |
| --- | --- |
| Every job | Bash and Git |
| Python CI, agent services, map data, MVP, staging deployment | Python 3.11 and pip, provided by `actions/setup-python` |
| Python CI (deployment selector tests), LifeFlow, Moving validation/staging, agent services | Node.js 24 and npm, provided by `actions/setup-node` |
| MVP | Node.js 22 and npm (existing workspace validation version) |
| Application images, PostGIS, MCP images, agent services, Moving validation/images/staging | Docker CLI and access to a Linux container engine through a Docker-compatible API |
| Agent services | Docker Buildx |
| MCP images | Make, awk, basename, dirname, xargs, Docker Buildx |
| Application image publisher | Docker Buildx |
| Moving validation/staging | OpenSSL and Docker Compose >= 2.24.4 (`!override` ports) |
| Staging deployment | Docker CLI with `docker manifest inspect`; no Docker daemon needed |
| Moving images | Docker Buildx, provided by `docker/setup-buildx-action` |

`scripts/check-ci-runner.sh` checks tools inside jobs before expensive work.
The setup actions verify language runtimes; job logs record actual versions
and Docker access. The runner also needs outbound access to GitHub Actions,
language package registries, Docker Hub, and GHCR for publishing or deployment
manifest checks. Staging deployment also needs outbound HTTPS access to
`COOLIFY_URL` and a trusted certificate chain. Set the repository secret
`COOLIFY_CA_CERT` to the private CA PEM if that instance requires one.
The deployment selector uses Node 24 bundled with `actions/github-script@v8`
(requires runner >= 2.327.1); the Python tests use Node 24 explicitly installed by
`actions/setup-node`. Most jobs have a 30-minute execution timeout; staging
deployment uses 10 minutes and the PostGIS build uses 40.
Python jobs that install dependencies create a fresh virtualenv in `RUNNER_TEMP`
and remove it with `always()`. Packages never install into the shared interpreter.

## Disposable resources

- Staging deployment logs into GHCR with the job's `GITHUB_TOKEN` and
  `packages: read`, using a temporary `DOCKER_CONFIG` under `RUNNER_TEMP`.
  The token needs pull access to the selected private packages; grant this
  repository access in each package's Actions access settings where needed.
  The job checks every distinct image manifest before contacting Coolify and
  removes the temporary registry credentials with `always()`. It does not pull
  image layers or start containers. Coolify keeps its own server pull credential.

- MCP and agent smoke jobs build images tagged by run ID and attempt, use
  unique container names without publishing host ports, and remove
  containers including anonymous volumes. Smoke scripts clean up on failure
  and termination. An `always()` step uses a job-specific container label as
  a cancellation fallback and removes only that job's image tags.
- Moving staging uses `moving-ci-<run-id>-<attempt>` as the Compose project.
  The CI overlay assigns matching image tags, random loopback ports, and a
  project-scoped database volume. `always()` steps collect diagnostics,
  remove that project's containers/networks/volumes, and delete its image tags.
- MCP HTTP smoke probes use `docker exec` against each service's loopback address
  to verify `/health` without relying on image healthcheck metadata. Moving's
  existing read-only deployment verifier runs in a disposable Node container
  on the Compose network. This supports runners using a host Docker socket:
  runner loopback and filesystem paths need not match the daemon host.
  Moving validation exercises the same verifier container and dependency copy
  with `--check-imports` on a disabled network, without invoking the provider.
- Never use a global Docker prune on a shared runner. Docker/BuildKit caches
  and downloaded base images are reusable host resources.

The Moving workflow's live provider verification still requires explicit `workflow_dispatch` with
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

The deployment tests also require Node 24:
`python -m pytest tests/test_coolify_deployment.py Frontend/tests/ -q`.
They fake registry inspections and API responses; no live deployment is made.

Actionlint 1.7.12 does not yet recognize GitHub's documented `concurrency.queue`
property ([upstream issue](https://github.com/rhysd/actionlint/issues/680)). With
that version, use this narrowly scoped exception for the known parser diagnostic:

```sh
actionlint -ignore 'unexpected key "queue" for "concurrency" section'
```

Keep `queue: max` with `cancel-in-progress: false`; GitHub rejects `queue: max`
with cancellation enabled. Other lint diagnostics remain enabled. Remove the
exception when actionlint supports the property.
