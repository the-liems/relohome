# Self-hosted CI

All validation and deployment jobs use `[self-hosted, linux, team-44]` and can
run on Linux x64 or ARM64 with the required tools. Application release builds in
`build-application-images.yml` and PostGIS builds in `postgis-image.yml` use
`[self-hosted, linux, ARM64, team-44]`. Their runners must carry all four labels.
When adding x64 capacity, retain available ARM64 capacity for release builds.
MCP and agent smoke builds use the Docker engine's native architecture; a remote
engine may differ from its runner host.
**Deploy to Coolify** (`deploy.yml`) deploys Git-pinned Applications and waits
for rollout completion and health. See the [deployment runbook](../../deploy/README.md).
Agent and Map workflows also watch the shared runner preflight; Moving change
detection requests validation when it changes. Agent CI watches the Python
environment helper too.

The baseline CI run on 2026-10-05 used `team-44-Doan0904`, Linux ARM64.
Most checks support Linux ARM64 and x64. The application-image matrix and PostGIS
publisher build ARM64 images and explicitly select an ARM64 runner.
The other jobs can use either architecture. Selecting only `team-44` does not
constrain the architecture, even when a Docker build specifies `--platform`. A successful ARM64 build
is not evidence of an amd64 release image.

## ARM64 runner availability and recovery

In repository Settings → Actions → Runners, verify that an online Linux ARM64
runner available to this repository carries `self-hosted`, `linux`, `ARM64`, and
`team-44`. The PostGIS build in run `38039269660` selected `team-44-arm64-2`
with all four labels and passed. Each ARM64 image job checks `uname -m` before
building, so an incorrectly labeled x64 runner fails immediately.

If image jobs remain queued, check runner status and labels first. Restore the
ARM64 runner's Actions service and GitHub connectivity, or register another Linux
ARM64 runner with all four labels and the tools listed below. Keep the ARM64
selector; assigning that label to an x64 runner does not provide native execution.
An online but busy runner will pick up the queued job when it becomes available.

`timeout-minutes` limits execution time only; it does not limit the wait for a
runner. While application images are queued, CI has not completed and the
`workflow_run` staging deployment cannot start. After restoring capacity, let a
still-queued run continue, or rerun a failed/cancelled run from Actions. Confirm
that the image jobs complete and the staging deployment workflow is triggered.

| Jobs | Required tools |
| --- | --- |
| Every job | Bash and Git |
| Python CI, agent services, map data, MVP, Coolify deployment | Python 3.11 and pip, provided by `actions/setup-python` |
| Python CI (deployment selector tests), ReloHome, Moving validation/staging, agent services | Node.js 24 and npm, provided by `actions/setup-node` |
| MVP | Node.js 24 and npm 11, matching root tooling |
| Application images, PostGIS, MCP images, agent services, Moving validation/staging | Docker CLI and access to a Linux container engine through a Docker-compatible API |
| Agent services | Docker Buildx |
| MCP images | Make, awk, basename, dirname, xargs, Docker Buildx |
| Application image publisher | Docker Buildx |
| Moving validation/staging | OpenSSL and Docker Compose >= 2.24.4 (`!override` ports) |
| Coolify deployment | Docker CLI with `docker manifest inspect`; no Docker daemon needed |

`scripts/check-ci-runner.sh` checks tools inside jobs before expensive work.
The setup actions verify language runtimes; job logs record actual versions
and Docker access. The runner also needs outbound access to GitHub Actions,
language package registries, Docker Hub, and GHCR for publishing or deployment
manifest checks. Coolify deployment also needs outbound HTTPS access to
`COOLIFY_STAGING_URL` / `COOLIFY_PRODUCTION_URL` and a certificate chain trusted
by the runner's standard trust store. CD has no custom CA secret or insecure TLS option.
The deployment selector uses Node 24 bundled with `actions/github-script@v8`
(requires runner >= 2.327.1); the Python tests use Node 24 explicitly installed by
`actions/setup-node`. Most jobs have a 30-minute execution timeout; Coolify
deployment uses 75 minutes and the PostGIS build uses 40.
Python jobs that install dependencies create a fresh virtualenv in `RUNNER_TEMP`
and remove it with `always()`. Packages never install into the shared interpreter.

Flight/Payment integration tests run real HTTP services with a test-owned
lifecycle. Application clients never create provider subprocesses. The existing
job-local virtualenv setup and dependency-install steps validate environment
creation directly. Python images use `COPY --chmod=u=rwX,go=rX` for source/config so files are
readable and directories traversable by existing non-root service users. Source
remains root-owned; the Dockerfile frontend is pinned to 1.14 for symbolic modes.
The normal MCP and agent smoke checks validate container startup.

## Migration SQL validation

Before publishing, migration image jobs execute the built image's default migration
command against a disposable PostgreSQL/PostGIS database. These checks validate
that the SQL applies successfully, creates the expected schema and migration
history, and grants access to application roles. A second run must succeed with
unchanged migration history. SQL errors or failed assertions fail the job before
the image is pushed.

The jobs build from the normal checkout. File ownership and modes are defined by
the Dockerfiles' `COPY` instructions; CI does not alter build-context permissions.
The checker uses PyYAML from the job-local environment to read database image tags
from `compose.coolify.yaml`. Each test uses isolated databases and credentials and
cleans up its containers and network on exit. PR jobs also log into GHCR so they
can pull private PostGIS images; publishing remains limited to main.

Coverage includes fresh database setup and rerunning the same migrations.
Upgrades from older release schemas remain a separate follow-up.

## Workflow ownership and release coordination

`CI` is the application-release coordinator. Python tests, MCP container smoke
checks, and TypeScript validation remain independent jobs. Application builds
call `build-application-images.yml`, a reusable workflow with an explicit service
name per matrix job. There is no explicit matrix concurrency cap; available
ARM64 runners determine how many application-image jobs execute simultaneously.
The catalog in `config/ci/application-images.json` owns each service's context,
Dockerfile, target, and build dependencies; add new services there and keep their
Compose image references in sync.

Pull requests use `scripts/select-ci-images.py` to build affected application
images. Shared contracts and lockfiles select every TypeScript consumer;
Dockerfiles, ignore files, and migration inputs select their consumers. Renames
include both old and new paths. Unknown inputs, CI configuration changes, or an
unreadable diff select all images. Known documentation and test-only changes can
skip application images; validation and smoke jobs still run.

Pushes and manual CI runs always build all eleven release images, including
the provisioner. GHCR publishing is allowed only on `main`, using full
`<commit-sha>` tags. `CI results` always runs and rejects failed/cancelled validation, failed selection, or skipped
requested image builds. Only a PR with zero selected images may skip builds.
`Deploy to Coolify` automatically selects successful main push CI runs; manual
CI runs do not trigger it. It verifies each SHA-tagged application manifest in
the selected Compose before deploying, then checks the deployed commit and
Application health. Manual dispatch can select any retained SHA on main.

`Moving containers` owns domain validation and the explicitly requested provider
staging check. Application CI owns its release images, so the Moving workflow
no longer publishes images or repeats the release image matrix. Manual Moving
staging verification still builds its own disposable Compose stack.
PostGIS remains an independent infrastructure-image publisher.

Use `CI results` and the existing `Moving container gate` as the stable required
checks. When adopting these display names, update any ruleset entries referring
to old job names; workflow/job IDs remain stable except for the removed Moving
image job. A gate must remain required when its child jobs are conditional.
Path-filtered workflows such as Map catalog and Intake/routing should not be
required unconditionally, because a filtered-out workflow can leave its checks
pending. This PR does not change repository protection settings.

## Disposable resources

- Coolify deployment logs into GHCR with the job's `GITHUB_TOKEN` and
  `packages: read`, using a temporary `DOCKER_CONFIG` under `RUNNER_TEMP`.
  The token needs pull access to the selected private packages; grant this
  repository access in each package's Actions access settings where needed.
  The job checks every distinct SHA-tagged application manifest before contacting
  Coolify and removes the temporary registry credentials with `always()`. It does not pull
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
capability-specific prerequisites. The normal CI setup and dependency-install
steps validate job-local Python environments. Image-selection and gate tests
cover shared dependencies, deleted/renamed paths, unknown-input fallbacks, full
release builds, and failed/skipped requested jobs.
Actual container compatibility and runner availability must additionally be
verified in Actions. Python assertion fixes are tracked separately in #45–#50.

The deployment tests also require Node 24:
`npm run deployment:check` (with the configured Python environment).
They fake registry inspections and API responses; no live deployment is made.

Root installation/build/test commands and browser prerequisites are documented in
[root tooling](root-tooling.md). npm CI caches use the single root lockfile; the
`lifeflow-typescript` job key remains unchanged for branch protection.
