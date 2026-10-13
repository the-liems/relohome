# #110 validation and lockfile review

Date: 2026-10-12. Base: `bf35392` (merged #121 naming contract; application
source matches `481288a`). Implementation branch: `feat/110-root-workspace`.
No services or persistent data moved. No deployment or provider write ran.

## Environment and exact reproduction

macOS ARM64; Python 3.11.16; Node 24.21.0; npm 11.12.1; Ruff 0.17.0;
Playwright 1.63.0; Docker 29.4.0; Chrome for Testing 155.0.8059.39.
The fresh developer environment is resolved in [python-freeze.txt](python-freeze.txt).
The tests also passed using the #109 environment. Node 26 was used for the
initial exploratory install/build; the acceptance install/build/TS checks
were repeated on Node 24. Node 24 is the supported runtime.

A disposable base was created with:

```sh
mkdir -p /tmp/p044-110-baseline-bf35392
git archive bf35392 | tar -x -C /tmp/p044-110-baseline-bf35392
python3.11 -m venv /tmp/p044-110-venv
PYTHON=/tmp/p044-110-venv/bin/python npm run setup:python
```

The last command runs from the implementation checkout. `PATH` was prefixed
with the temporary Node 24 executable directory for all final Node commands.
Python commands below use `P=/tmp/p044-110-venv/bin/python`; root npm commands
use `PYTHON=$P`. Set `APP_ENV=test OPENAI_API_KEY=test-key` for Python tests.
No local `.env`, keys, database files or ignored user artifacts were copied.
Loopback, browser and Docker checks ran outside the restricted shell sandbox.

System Chrome installation (`npm run setup:browser`) needed an interactive
administrator password here. Instead, the official Chrome for Testing stable
manifest selected 155.0.8059.39, downloaded from:
`https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/mac-arm64/chrome-mac-arm64.zip`.
Both browser runs set `PLAYWRIGHT_CHROME_EXECUTABLE_PATH` to
`/tmp/p044-110-chrome/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
The base copy used an untracked config extending its original default config
with only this executable override. Existing projects, assertions, timeouts,
workers, providers and test selection were preserved.

## Results

| Check | Base `bf35392` | Implementation |
| --- | --- | --- |
| Python `P -m pytest tests/ Frontend/tests/ 'Maps VN/LifeFlow/demo/test_demo.py' -q --tb=short` / root `npm test` | 831 passed, 90 skipped, 138 subtests passed | 832 passed, 90 skipped, 137 subtests passed; new root-lock image-selector coverage replaces one obsolete child-lock subcase |
| npm clean install and builds | `npm ci --offline --no-audit --no-fund && npm run build` in each of LifeFlow, Frontend, map-app: pass | Root `npm ci --offline --no-audit --no-fund && npm run build`: all 10 packages pass on Node 24 |
| Portable TS | LifeFlow `npm run test:ci`, then `npm exec --offline --workspace @lifeflow/mcp-server -- vitest run tests/mcp-http.integration.test.ts`: 60 passed, 14 skipped | `npm run test:ts` / `npm run test:ci`: same 60 passed, 14 skipped |
| Pure frontend contracts | Frontend `npm exec --offline -- playwright test --config playwright.contracts.config.ts`: 19 passed | `npm run test:contracts`: 19 passed |
| CI lint | Existing Python scope passes | `npm run lint`: Python plus existing map oxlint passes |
| Formatting | `ruff format --check src/ tests/`: 34 files would change | `npm run format:check`: same 34; no formatting applied |
| Whole-repository lint | `ruff check .`: 9 findings | Same 9; see B2 |
| Deployment contracts | Included in base Python suite | `npm run deployment:check`: 53 passed, 85 subtests |
| Images | All seven affected images build and pass startup/packaging probes | All seven pass with root lock/context; see scope below |
| Worker assets | Three original installs/builds pass | `npm run check:assets`: installed bytes match both public and built output in web/map |
| Workflows | Existing runner contracts | actionlint passes for CI, MVP, agent-services, moving-containers |
| Compatibility and opt-ins | Existing command entrypoints | `npm --prefix 'Maps VN/LifeFlow' run build:moving` passes; `test:live` without acknowledgement exits 1 before providers |
| Moving delivery | Existing Compose/verifier | All three Compose configurations render; network-disabled Docker verifier imports hoisted MCP client and moving-service successfully |

Image command: `PYTHON=$P npm run image:check`. For the base, the same
read-only test harness was copied into the disposable base and invoked with
`P scripts/check-workspace-images.py` against the base's original catalog,
Dockerfiles and lockfiles. This is a test harness addition only, not changed
application/build inputs. The seven images are web, platform, location,
moving-api, moving-mcp, location-migrate and moving-migrate. Five application
images ran their default USER/CMD with no external network or mounted data.
Web additionally imported `Frontend.server`; both migration images passed
syntax and packaged-SQL checks. Platform's HTTP listener returned the expected
404 at `/`; its PostGIS-backed `/health` was not claimed ready. The first
exploratory probe incorrectly requested `/health` without a database, was
corrected, then all seven base/head probes passed. No application was changed
to weaken health checks. Temporary containers/tags were removed by the harness.

Moving verifier command, from root:

```sh
COMPOSE_PROJECT_NAME=p044-tooling-110-imports \
  bash 'Maps VN/LifeFlow/scripts/verify-moving-ci.sh' --check-imports
```

Compose rendering used fresh throwaway values for `MOVING_DB_ADMIN_PASSWORD`,
`MOVING_DB_APP_PASSWORD`, `MOVING_MCP_AUTH_TOKEN`, `MOVING_MCP_WRITE_TOKEN`,
`MOVING_APPROVAL_TOKEN`, and `AHAMOVE_WEBHOOK_SECRET`. Commands were
`docker compose -f 'Maps VN/LifeFlow/compose.moving.yaml' config --quiet`, then
the same with each of `compose.moving.ci.yaml` and
`compose.moving.staging-write.yaml` as the second `-f` argument. No stack was
started and no persistent volume changed.

## Browser comparison and B2/B3/B5 triage

Full baseline command (Frontend cwd):

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/p044-110-base-browser.json \
  npm exec --offline -- playwright test --config playwright.baseline.config.ts \
  --workers=2 --reporter=line,json
```

Full implementation command (root cwd):

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/p044-110-head-browser.json \
  npm run test:browser -- --reporter=line,json
```

Both use the Chrome executable setting above. The full runs collected the same
246 cases. Base: **179 passed, 41 failed, 26 skipped** (9.2m). Initial head:
**180 passed, 40 failed, 26 skipped** (7.0m). There are **zero new head failure
IDs**. Machine-readable [base failures](browser-base-failures.tsv) and
[initial head failures](browser-head-failures.tsv) retain the exact results;
these are not represented as green browser suites.

- **B2:** all nine historical repository-wide lint findings remain unchanged.
  CI's established scope passes. The additional read-only formatting check
  exposes 34 existing files; `make check` correctly fails on this debt, and
  `make -n check` invokes `format:check`, never `format`. Logging-script lint
  remains coordinated with #105; no logging files were edited.
- **B3:** the standard browser is now provisioned without changing channel or
  falling back to Chromium. Four map-scope cases initially still failed to
  launch because their test-level `launchOptions` replaced the config options.
  That test now also honors the executable override. Its raw app-local
  `/node_modules/maplibre-gl/...` import was changed to Vite's resolved module
  URL `/@id/maplibre-gl`, exercising the hoisted package and actual worker.
  A focused head run passes all four desktop/mobile cases. The same base
  cases are rerun with only the executable override added to the disposable
  test file: **all four also pass on base** (7.6s; head 8.4s). The full-run TSVs preserve the
  initial prerequisite errors rather than silently deleting them.
- **B5:** all 36 failures in #109's historical Chromium register recur on the
  current base and initial head. The baseline adds the four B3 prerequisite
  cases and one mobile landing accessibility case whose browser context was
  destroyed during navigation; the latter passes on head. That is variable
  behavior, not a claimed accessibility fix. Existing UI/fixture failures stay
  tracked by #110, #113 and #116. No assertions or test selection were reduced.

The four-case rerun command is the full command above plus `map-scope.spec.ts`,
with output files `/tmp/p044-110-{base,head}-map-scope.json`. The other 242 cases
were not affected by the map test's isolated import/launch-options correction.
Provider skips remain opt-in; there were no real bookings or payments.

## Dependency resolution review and replay

No manifest dependency ranges changed. All **240 external package names** are
retained and no new external version was introduced. `source-map-js` previously
had 1.2.1 and 1.2.2 across the three locks; npm deduplicated the compatible
`^1.2.1` requests to the already locked 1.2.1. All other external version sets
are unchanged. Conflicting frontend/service resolutions were initially seeded
under their existing consumer and retained where needed (including Vite's
Rolldown graph); this is not a blanket upgrade to latest dependencies.

The migration seed can be reproduced with [reconcile-lock.mjs](reconcile-lock.mjs)
on this implementation revision:

1. Create a scratch directory and copy root `package.json` and the ten workspace
   manifests there, preserving their relative paths.
2. From the implementation root, run
   `node docs/integration/monorepo-tooling/reconcile-lock.mjs bf35392` and save
   stdout as the scratch `package-lock.json`.
3. **Change directory into the scratch root** and run Node 24/npm 11.12.1:
   `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund`.
4. Compare its output with root `package-lock.json`: **byte-for-byte identical**.

The one-time seed script reads the three original locks from git, rewrites only
workspace locations, and keeps locked versions/integrities. Normal npm
maintenance now uses only the authoritative root lock, never those historical
child locks. The Docker adapter derives a disposable image-local path view of
this lock so runtime directories and persisted paths stay unchanged.

## Remaining validation boundaries

Full PostGIS/domain integration, real provider checks, Windows launch execution,
map demo journeys requiring local geodata/services, and staging existing-data
and digest rollback remain explicit #87/#113/#116 gates. All builds and worker
checks cover the retained map demo; it was not removed or presented as having
passed its external-service browser journeys. No production promotion is
implied. See [root tooling rollback](../../runbooks/root-tooling.md#images-validation-and-rollback).
