# Web and browser gateway separation (#113)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Base: `b37e04a` (merged #110, #111, #112 and naming decision #118/#121).
The browser is `apps/web` (`siu-ai-web`); the installable gateway is
`apps/browser-gateway/src/relohome_gateway` (`relohome-browser-gateway`).
The existing combined `web` image, port 8503, one worker, routes, cookies,
Compose service/image identifiers and release/digest promotion remain unchanged.
Browser source/components/styles move without redesign or App.tsx refactoring.

## Development and tests

**Existing checkouts:** after pulling this relocation, run `npm ci` and
`npm run setup:python` from the repository root before starting services or tests.
The previous editable install maps `relohome_gateway` to `Frontend/`; reinstalling
updates that mapping to `apps/browser-gateway/src/relohome_gateway`. A stale
mapping now raises an explicit reinstall error before loading forwarding modules.
Keep the existing virtual environment and persisted data; no data migration is needed.

For a new checkout, use Node 24/npm 11 and Python 3.11:

```sh
npm ci
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run build
npm run dev:web
npm run dev:gateway
npm run test:python
npm run test:contracts
npm run test:browser
npm run deployment:check
npm run image:check -- web
```

Root commands keep the existing environment-file and runtime-root interface.
When launching `python -m uvicorn relohome_gateway.server:app` directly, set
`RELOHOME_RUNTIME_ROOT` to the absolute **existing** deployment/checkout root.
Installed and editable gateway packages no longer infer a root from module depth.
An absent/relative root fails rather than creating a database under the new app.

Gateway-only tests live in `apps/browser-gateway/tests`; tests combining backend
and gateway implementations and browser fixture servers live in
`tests/browser_gateway`. Browser/contract tests and Playwright configs live in
`apps/web`. All root commands collect the same existing tests. Python browser
fixture launchers use `scripts/python.mjs` for Windows/macOS/Linux interpreter
selection and runtime configuration. Provider-dependent suites remain opt-in.

## Persistent paths and rollback

| Interface | Preserved location/behavior |
| --- | --- |
| Database | `<runtime-root>/data/siu-web.sqlite3` |
| Traveler key | Database sibling `siu-web-traveler.key`; existing DB without its key fails |
| Local housing media | `<runtime-root>/Frontend/data/housing-media` (intentionally retained) |
| Container housing media | Existing Compose `SIU_HOUSING_MEDIA_DIR=/app/data/housing-media` |
| Browser assets | `<runtime-root>/apps/web/dist`, served by the same gateway |
| Overrides | `SIU_WEB_DB`, `SIU_TRAVELER_KEY_FILE`, `SIU_TRAVELER_KEY`, `SIU_HOUSING_MEDIA_DIR` unchanged |
| Browser state | `siu_session`, `siu-ui-preferences`, `siu-plan-strip-open`, `siu-draft-`, `relohome.mode`, `relohome-analytics-id` unchanged |

Do not move `Frontend/data`, `data`, logs, keys or user-uploaded media when updating
source. Roommate private-state/backup/demo rejection covers the legacy public
root and the new `apps/web/public` and `apps/web/dist` roots. Existing
runtime/storage settings, privacy behavior and encryption pairing are retained.

Rollback: revert this PR, reinstall the reverted root requirements/workspaces,
rebuild the browser, and select the previous published `web` image digest through
the existing release process. No database restoration, path migration, cookie
reset or new traveler key is needed. No deployment is performed by this PR.
Existing staging data/digest evidence remains #116's release gate.

## Compatibility and coordination

Owner: #113 author; removal owner: #115, subject to #118's consumer and installed
image gates. `Frontend/{server,store,roommate_gateway,runtime_paths,admin_provision,
cloud_backup}.py` are forwarding modules, not duplicate implementations. They
preserve module identity; the admin/backup modules also forward CLI entrypoints.
Known consumers are pre-migration source launchers/operations commands recorded
by #112 and old gateway imports embedded in PR #76's live browser helpers.
New callers and images use the canonical installed namespace. No npm shim or
second workspace is added. `Frontend/data` is permanent persisted-state
compatibility and must not be deleted when source shims are removed.

PR #76 is open on `fix/75-housing-comparison-isolation` against
`fix/73-search-scope-roommate-map`. Its eight overlapping browser paths keep their
relative suffixes under `apps/web`: two Playwright configs, App.tsx,
HousingComparison.tsx, PlanPeek.tsx, serviceJourney.ts and two browser specs.
Rebase that PR onto the merged relocation and use `relohome_gateway.store` in
its live helpers. No housing behavior from #76 is incorporated here. PR #107
must use `apps/web/Dockerfile` and the canonical gateway package when rebasing
its telemetry/image changes. Domain review follows existing CODEOWNERS.

## Validation

The image smoke gate imports installed gateway/shared packages from `/tmp` in
isolated Python mode and starts the image's default non-root CMD without host
mounts, published ports or providers. It requests `/health`, `/`, an emitted JS
asset and a nested SPA route. The image contains installed Python packages and
built browser assets, with no application source-tree import dependency.

The relocation regression seeds the legacy database/key/media locations, opens
from `Frontend`, `apps/web`, `apps/browser-gateway` and an unrelated cwd, then
checks the same session, saved conversation, encrypted traveler and media.
Missing configuration/key checks prove startup does not create replacement
state. Browser source and persisted-key strings remain byte-identical apart
from test-launcher paths; the API display title becomes ReloHome.

Validation used Node 24.19.0, npm 11.12.1, Python 3.11.16 and the existing
Chrome for Testing executable. Both full browser runs used the same executable,
2 workers, desktop/mobile projects, and no provider flags; `.env.local` was an
empty file in the isolated worktree (no real credentials).

| Check | Result |
| --- | --- |
| Unchanged-base Python/gateway/demo suite | 904 passed, 103 skipped, 136 subtests |
| Relocated Python/gateway/demo suite | 918 passed, 103 skipped, 136 subtests |
| Root `npm ci`, `npm run build`, `npm run test:ci` | Passed; all workspaces, MapLibre assets and 42 pure browser contracts |
| Deployment/configuration checks | 55 passed, 84 subtests |
| Existing CI Ruff scope + new image smoke script | Passed |
| Real Roommate browser/API/gateway fixture | 4 passed |
| Seeded legacy browser preferences/draft/identity test | 2 passed, desktop + mobile |
| Browser source/assets comparison | All 129 files byte-identical to base |
| Root lockfile comparison | All 285 entries unchanged except workspace path/link metadata |

Full browser baseline: **318 passed, 44 failed, 34 skipped, 396 collected**
(21.8 minutes). [Exact failure IDs and first errors](web-gateway-relocation/browser-base-failures.tsv)
retain every failure, without suppressing tests or weakening assertions.
34 of the 36 historical #109 failures recur. Both historical moderator queue
failures now pass. Ten additional current-base failures cover conversation
reset, mobile map accessibility, review moderation, public guide destinations,
mobile landing accessibility and mobile Roommate accessibility. These are
pre-existing UI/fixture expectations or timing failures, tracked with the
historical B5 debt in [#116](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/116).
This source move does not claim to repair them or certify the full UI suite green.

Browser commands (run from root; executable supplied through the existing
`PLAYWRIGHT_CHROME_EXECUTABLE_PATH` setting):

```sh
npm run test:browser -- --reporter=line,json
npm exec --offline --workspace apps/web -- playwright test --config playwright.roommate.config.ts
npm exec --offline --workspace apps/web -- playwright test --config playwright.roommate-ui.config.ts app.spec.ts --grep 'relocation preserves' --workers=2
```

Full head browser comparison: **322 passed, 40 failed, 34 skipped, 396 collected**
(13.1 minutes), with **zero new failure IDs**. The unchanged source plus four
base-only timing failures do not constitute UI fixes. [Exact head failures](web-gateway-relocation/browser-head-failures.tsv)
keep all 40 known failures visible. The two new persisted-browser-state cases
were run separately after this full collection and both passed.

The unchanged deterministic suites exercise login, conversation/account history,
housing/viewing, moving, checkout approval and Roommate fixtures. Provider flags
remain disabled. The existing broad UI failures still require #116 triage;
no visual/product behavior changes are mixed into this relocation.

## Combined image evidence

[ARM64 web image build and smoke](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/38356033354/job/115159850612)
passed for implementation commit `bcb84ee`: installed gateway/shared imports
from `/tmp` under `python -I`, default non-root startup, health, HTML index,
emitted JavaScript and nested SPA fallback. The complete CI run also passed,
including all ten application images. No image was published or deployed by
this PR run.

Local Docker attempts encountered registry connection resets/timeouts; npm
also returned success after silently dropping an optional Linux Rolldown binding
whose download failed. The final Docker build adds longer build-only download
timeouts and verifies `vite --version` before caching the dependency layer.
That check was verified to reject the incomplete cached Linux install and to
succeed with the complete local install. These changes do not alter application
sources, dependency versions or runtime configuration. Duplicate local downloads
were stopped once the CI runtime gate passed. Subsequent CI reruns validate the
final build guard/documentation revision before merge.
