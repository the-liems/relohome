# Migration baseline validation

Source: `9b2b2dbddee8e55d7219be7de3348e815b1e50f4`; inspected 2026-10-12.
**Historical evidence:** the PR publication base is newer `263c4a9`; see
[current-base reconciliation](current-base.md). None of these runtime results
are presented as tests of that newer base.

This record separates local results, commit-specific CI evidence and unexecuted
checks. No deployment or provider transaction was requested or performed.

## Environment and reproduction

Local: macOS ARM64, Python 3.11.16 (system `python3` is 3.14.5), Node 26.0.0,
npm 11.12.1, Docker client/server 29.4.0. CI uses Linux self-hosted `team-44`,
Python 3.11 and Node 24; the MVP workflow still selects Node 22. Local Node 26
results supplement rather than replace CI's Node 24 gate. Python requirements
are ranges; [resolved versions](python-freeze.txt) record this local installation.
Existing checkout `.venv/bin/python -m pytest --version` failed with
`No module named pytest`; it was not modified.

The disposable copy contains only committed files and no local `.env` or data:

```sh
mkdir -p /tmp/p044-109-baseline
git archive 9b2b2dbddee8e55d7219be7de3348e815b1e50f4 | tar -x -C /tmp/p044-109-baseline
.venv/bin/python -m venv /tmp/p044-109-venv
/tmp/p044-109-venv/bin/pip install -r /tmp/p044-109-baseline/requirements.txt -r /tmp/p044-109-baseline/requirements-agents.txt
```

`P` below means `/tmp/p044-109-venv/bin/python`, `R` means its sibling `ruff`;
commands use these absolute executables. `root`, `web`, `LifeFlow`, `map-app`
mean directories within the disposable copy. npm used committed lockfiles.
Network installs and loopback/browser checks needed sandbox escalation; no
repository security or test configuration was changed.

## Local commands and observed results

| Directory | Exact command (with P/R expanded as above) | Result |
| --- | --- | --- |
| root | `APP_ENV=test OPENAI_API_KEY=test-key P -m pytest tests/ Frontend/tests/ -q --tb=short` | 757 passed, 90 skipped, 98 subtests passed; one loopback permission failure; 30.74 s |
| root | `APP_ENV=test OPENAI_API_KEY=test-key P -m pytest tests/test_agents/test_mcp_http_client.py -q --tb=short` (outside sandbox) | The single failed test passes, 1 passed in 1.76 s; aggregate 758 passed matches CI |
| root | `R check src/ tests/ scripts/deploy-coolify.py` | Pass |
| root | `R check .` | 9 existing findings; see B2 |
| LifeFlow | `npm ci` | Pass, 142 packages |
| LifeFlow | `npm run build` | All eight workspaces pass |
| LifeFlow | `npm run test:ci` | 37 passed; 14 skipped; mcp-core and moving-api report no tests (allowed by existing scripts) |
| web | `npm ci` | Pass after network retry, 62 packages |
| web | `npm run build` | TypeScript/Vite pass |
| web | `npx playwright test --config playwright.contracts.config.ts` | 8 passed, 482 ms; these are pure contracts, not browser journeys |
| web | `npx playwright test --config playwright.config.ts --workers=2` | Sandbox Vite bind failed; escalated rerun: 154 failed to launch missing system Chrome, 22 passed, 26 skipped; 33.1 s. See B3 |
| map-app | `npm ci && npm run build` | Pass after network retry; non-fatal large-chunk warning |
| LifeFlow | `P -m pytest demo/test_demo.py -q` | 4 passed, 0.25 s |
| root | `P scripts/verify-map-data.py` | 3 boundaries verified, 948,621 bytes unchanged |
| root | `P scripts/test-map-data.py` | 9 passed |
| root | `P -m pytest tests/test_coolify_deployment.py tests/test_deployment_settings.py tests/test_web_image_layout.py -q` | 29 passed, 48 subtests passed; 1.88 s |
| root | `docker version --format '{{.Client.Version}} {{.Server.Version}}'` | Escalated read-only check: 29.4.0 / 29.4.0 |

The full suite already includes deployment tests; the focused run records their
scope explicitly. Logs were captured under `/tmp/p044-109-*.log`; durable
summaries and CI permalinks are here. No ignored runtime data was copied into
this repository as evidence.

## Commit-specific CI evidence (2026-10-09 UTC)

Downloaded and inspected logs, not inferred from a green badge alone:

- [CI run 37976434593](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37976434593):
  `ruff check src/ tests/ scripts/deploy-coolify.py` passed;
  `APP_ENV=test OPENAI_API_KEY=test-key python -m pytest tests/ Frontend/tests/ -v --tb=short`
  yielded **758 passed, 90 skipped, 98 subtests passed in 44.84 s**.
  LifeFlow `npm ci`, `NODE_OPTIONS=--max-old-space-size=512 npm run build`,
  `npm run test:ci` passed: 37 tests, 14 skipped, two workspaces with no tests.
- Same CI run: `make mcp-build` with `MCP_IMAGE_TAG=ci-37976434593-1`, then
  `bash scripts/smoke-mcp-containers.sh` passed. Flight health reported
  `vn-flight-booking` / mock; Payment `vn-payment` / mock / simulation true.
  Both are real runtime images, not source-only imports.
- Same CI run built all nine application images for `linux/arm64`. Exact
  generic command below; service/context/target mapping is in the inventory.
  `docker image inspect "$IMAGE"` passed, and the web image ran
  `docker run --rm --entrypoint python "$IMAGE" -c "import Frontend.server"`.
  These builds do not prove full backend/DB readiness or inter-service reachability.
- [Standalone run 37976434661](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37976434661):
  `pip install -r requirements.txt -r requirements-agents.txt`;
  `ruff check src/agent_services tests/test_agent_services scripts/smoke-agent-containers.py`;
  `pytest tests/test_agent_services -q`: **21 passed, 4 skipped**.
  LifeFlow `npm ci && npm run build --workspace=@lifeflow/contracts` and root
  `node scripts/export-agent-registry.mjs --check` passed.
  Both `docker buildx build --load -f Dockerfile.agents --target intake -t "lifeflow-intake:$AGENT_IMAGE_TAG" .`
  and corresponding `orchestrator` target passed (`AGENT_IMAGE_TAG=ci-37976434661-1`).
  `python scripts/smoke-agent-containers.py` reported PASS for both real-image
  HTTP liveness/readiness and isolated configuration.
- [Moving run 37976434462](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37976434462):
  `npm ci && npm run build:moving && npm run test:ci` passed. Syntax checks for
  `scripts/{moving-stack,test-moving-native,verify-moving-deployment}.mjs` and
  `bash -n scripts/verify-moving-ci.sh` passed. All three Compose renderings
  below and `bash scripts/verify-moving-ci.sh --check-imports` passed.
  `COMPOSE_PROJECT_NAME=moving-validate-37976434462-1`; temporary credentials
  were independently generated with `openssl rand -hex 32` for
  `MOVING_DB_ADMIN_PASSWORD`, `MOVING_DB_APP_PASSWORD`, `MOVING_MCP_AUTH_TOKEN`,
  `MOVING_MCP_WRITE_TOKEN`, `MOVING_APPROVAL_TOKEN`, `AHAMOVE_WEBHOOK_SECRET`.
  This validates imports/config, not live provider writes.
- [Map catalog run 37976434476](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37976434476)
  and [PostGIS image run 37976434579](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37976434579)
  succeeded at the same SHA.
- [Staging submission run 37978309638](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/37978309638)
  succeeded for CI 37976434593. It is historical deployment-submission evidence,
  not a new deployment, an existing-data check or proof of successful rollback.

```sh
# CI matrix supplies IMAGE, DOCKERFILE, BUILD_CONTEXT, BUILD_TARGET.
# IMAGE=ghcr.io/ai20k-build-phase-cohort-4/p-044/<service>:9b2b2dbddee8e55d7219be7de3348e815b1e50f4-37976434593
options=()
if [ -n "$BUILD_TARGET" ]; then options+=(--target "$BUILD_TARGET"); fi
if [[ "$BUILD_TARGET" == moving-* ]]; then options+=(--build-arg "RELEASE_SHA=$GITHUB_SHA"); fi
docker buildx build --load --pull --platform linux/arm64 "${options[@]}" \
  --file "$DOCKERFILE" --tag "$IMAGE" \
  --label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY" \
  --label "org.opencontainers.image.revision=$GITHUB_SHA" "$BUILD_CONTEXT"

# LifeFlow cwd; isolated credentials and project above:
docker compose -f compose.moving.yaml config --quiet
docker compose -f compose.moving.yaml -f compose.moving.ci.yaml config --quiet
docker compose -f compose.moving.yaml -f compose.moving.staging-write.yaml config --quiet
```

## Failure and coverage register

### B1 — local environment prerequisites (resolved for this record)

Existing `.venv` lacks pytest; sandbox DNS denied initial pip/browser downloads,
web npm install failed, map npm reported `Exit handler never called!`, and socket
binding was denied. Separate venv/network-enabled installs and loopback reruns
resolve these without changing application code. Root setup documentation in
[#110](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/110) must make
prerequisites explicit. Do not report these as application regressions.

### B2 — repository-wide lint debt

Ruff 0.17.0 reports nine findings: `Frontend/__init__.py` N999;
`scripts/log_antigravity.py` I001; `scripts/log_hook.py` I001 and two N806;
`scripts/log_manual.py` I001, F541;
`scripts/submit_log.py` I001, UP017. CI's narrower scope passes unchanged.
Track root-check scope and baseline resolution under
[#110](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/110); logging
changes must coordinate with [#105](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/105).
No lint exclusions or unrelated fixes are introduced here.

### B3 — browser runner prerequisite

The committed default config uses `channel: "chrome"`; this machine has no
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. All 154 launch
failures have that cause; 22 pure/non-browser cases pass and 26 live cases skip.
This run is **not a passing browser baseline**. Provision a documented browser
under [#110](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/110) and
retain full deterministic journeys as a gate in
[#116](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/116).

### B4 — explicit remaining coverage

Portable Node `test:ci` omits housing-query/platform/location database suites;
Moving native/HTTP/live tests are separately configured. Python has 90 opt-in
skips. Browser live providers remain disabled. Windows launchers were inspected,
not executed on macOS. Streamlit demo server/provider UI startup and map-app
browser integration were not run. Full integrated DB/service reachability and
staging existing-data/rollback checks remain #87/#116 gates. Image builds and
import smokes must not be substituted for these checks. No production deployment,
AhaMove write, ZaloPay payment or Flight booking was exercised.

## Supplemental Chromium browser run

To get executable UI evidence without installing system Chrome, downloaded
Playwright Chromium 153.0.8010.12 (revision 1243) into `/tmp`:

```sh
# cwd: /tmp/p044-109-baseline/Frontend
PLAYWRIGHT_BROWSERS_PATH=/tmp/p044-109-browsers npx playwright install chromium
```

Created **only in that disposable copy** `playwright.baseline.config.ts`:

```ts
import { defineConfig } from '@playwright/test';
import config from './playwright.config';
export default defineConfig({ ...config, use: { ...config.use, channel: 'chromium' } });
```

Ran with loopback/browser permissions:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/p044-109-browsers npx playwright test --config playwright.baseline.config.ts --workers=2
```

This inherits every test, viewport, assertion, timeout and provider opt-in from
the committed config. Only browser channel changes. It does not convert the
failed committed-Chrome command into a passing check. Results below are a
supplemental baseline on unmodified application/test source, not migration
regressions; repeat on the standardized browser before attributing causes.

Result: **140 passed, 36 failed, 26 skipped (202 collected), 6.0 minutes**.
All 36 failures are recorded by project and test ID in
[browser-failures.tsv](browser-failures.tsv). No tests were disabled or rewritten.

### B5 — deterministic UI baseline failures on supplemental Chromium

The same 18 test cases fail on both desktop and mobile:

- 32 failures concern rendered workspace/controls or expected text: Flight
  timeline/results/details, Moving partial replies/quotes/expiry, Housing
  map/selection/progress, POI distance and tracking links. Most expected
  elements are absent; some clicks time out. Error snapshots show the fixture
  conversation and service-result message while the expected workspace is not
  open. This is a UI/fixture-contract investigation, not evidence that an expiry
  timer or real provider failed. Actual root causes are not yet established.
- Two failures expect the saved-account tab to have keyboard focus but it remains
  inactive (`app.spec.ts:333`). Compare native/browser focus and current UI flow.
- Two failures observe a moderation rejection payload with `decision: reject`
  but without expected `reason: "Thiếu ảnh phòng"`
  (`housing-product.spec.ts:97`, assertion at line 120). Review form/payload
  behavior with the Housing owner; do not weaken the assertion to hide it.

Triage is linked to the [#110 baseline/tooling gate](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/110),
[#113 web migration gate](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/113)
and [#116 full validation gate](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/116).
Resolve or explicitly reproduce on standardized Chrome before web moves; compare
exact base/head failure IDs. These results are not the historical browser counts
in `Frontend/tests/README.md`, and no claim of a green browser baseline is made.
