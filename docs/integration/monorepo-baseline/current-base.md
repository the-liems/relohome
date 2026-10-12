# Publication-base reconciliation

The original inventory and executed test baseline are pinned to
`9b2b2dbddee8e55d7219be7de3348e815b1e50f4`. Before opening the PR, the isolated
worktree was created from newer main `263c4a9e5f986758dbc78a237d61c3a7b8d8ff58`.
**This addendum takes precedence over historical inventory statements below.**
The old test results are not results for the publication base.

## Naming-scope update

The subsequently updated #109 adds a case-insensitive LifeFlow naming inventory;
see [the matrix and complete occurrence evidence](naming-inventory.md).
#118 records final ReloHome names and aliases in ADR-025 before #110–#116
implementation. Target columns use those names; original path evidence stays exact.
Preserved operational identities remain compatibility exceptions.

## Complete source mapping

The publication base retains all 1,015 baseline paths and adds 47 paths.
[current-base-additions.tsv](current-base-additions.tsv), together with
[path-map.tsv](path-map.tsv), maps all **1,062** tracked publication-base files
exactly once. There are no deletions or renames between the two source revisions.
This PR's own documentation additions are retained under `docs/`.

The additions include frontend source/tests and an eleventh Playwright config,
shared Python MCP HTTP authentication, MCP-core authentication, housing-query
helpers/tests, four SQL migrations and a rollback script, new operations scripts,
image selection/reusable build configuration, production CD and documentation.
The target prefix rules remain the same; shared MCP HTTP has the explicit target
`packages/python/mcp-http/src/relohome_mcp_http/__init__.py`, distribution
`relohome-mcp-http`. Both MCP apps depend on it; it cannot import applications.
Its authentication helpers remain owned by the MCP transport maintainers.

ADR-024 was allocated by the intervening routing change, so this PR uses
**ADR-025**. No existing ADR is overwritten.

## Changed operational contracts

- `config/ci/application-images.json` is now the authoritative **ten-image**
  catalog, including `payments-mcp`. `scripts/select-ci-images.py` selects PR
  images; `.github/workflows/build-application-images.yml` builds them. These
  already exist on main, rather than being conditional additions from #107.
  #110/#111/#114 must update catalog `paths` and reusable workflow references
  together; preserve selection tests and the final CI gate. The reusable image
  job explicitly requires `[self-hosted, linux, ARM64, team-44]`.
- CI's Ruff command now includes `scripts/test-migration-image.py` and
  `scripts/select-ci-images.py`. Migration images are exercised against
  disposable databases via `scripts/test-migration-image.py`, not just built.
  Preserve these checks and their ARM64 isolation; historical nine-image build
  evidence does not cover the new pipeline.
- `compose.coolify.yaml` now runs **dedicated Payment HTTP MCP**, with backend
  `PAYMENT_MCP_URL=http://payments-mcp:8766/mcp`, and authenticates Flight/Payment
  using their service-specific tokens. Keep the `payments-mcp` image/service,
  payment storage volume and secret interfaces. Both Python MCP servers share
  `src/mcp_servers/http_service.py`. Their settings, stdio clients and demos also
  changed: port/transport behavior must be derived from this base's files, not
  restored from the historical inventory. Retain shared authentication fixtures
  and `tests/mcp_http.py` under cross-application tests.
- `.github/workflows/deploy-coolify.yml` is shared by staging and production
  callers. `deploy-production.yml`, production runbooks and environment settings
  already exist. Preserve their protected release-selection/promotion behavior;
  the existence of production CD does not authorize running it for this task.
- `Frontend/playwright.landing.config.ts` and landing, moving-submission,
  staging-context and viewing tests are new. UI and provider-routing behavior
  has changed; the old 36 Chromium failures cannot be asserted to remain present
  on current main. Re-establish the browser baseline on the actual move base.
- SQL `019`–`022` and `database/rollbacks/housing_query_performance.sql` are
  tracked resources to move with the database tree, not commands to execute.
  New `check-device-provider.mjs` and `verify-housing-query-performance.mjs`
  remain explicit operational checks under `scripts/lifeflow/` after relocation.
- `src/agents/location_names.py` moves with agent internals. New frontend error,
  submission and polling modules move with web. No new generic shared package
  is justified by these additions.

## Coordination and validation gate

#107 still requires coordination for telemetry code, Docker/runtime changes and
its updates to the now-existing image catalog/shared HTTP module. Conditional
telemetry destinations in the original inventory remain valid; the catalog and
HTTP module themselves are now part of the tracked mapping. #76 still overlaps
housing UI and agent behavior and must be rebased onto the eventual move base.

The recorded Python/TS/browser/image results remain historical evidence for
`9b2b2db`. This publication step validates documentation links, unique mapping
coverage and the docs-only diff on `263c4a9`; it does **not** rerun every runtime
suite or claim a fresh green baseline. Keep the PR draft and #109 open until
reviewers accept the target mapping and reconcile current-base validation and
PR coordination before #110–#116 implementation.

## Additional relocation-sensitive paths

- `scripts/check-device-provider.mjs:5–7` and
  `scripts/verify-housing-query-performance.mjs:8` (under the old LifeFlow root)
  import `../packages/housing-query/dist/...`. After moving into `scripts/lifeflow/`,
  that points at `scripts/packages`; #111/#115 must resolve root packages explicitly.
- The performance script derives root from `new URL('..', import.meta.url)` for
  package.json, node_modules/.cache, built housing-query and .env. Preserve env
  precedence and resolve the new repository root explicitly. Its `git show`
  path `Maps VN/LifeFlow/packages/housing-query/src/housing-service.ts` must be
  selected per referenced revision: support both historical old paths and new
  `packages/housing-query/src/housing-service.ts` paths after the move.
- `packages/mcp-core/tests/auth.test.ts:6` under LifeFlow reads
  `../../../../../tests/fixtures/internal-mcp-auth.json`; relocation puts it above
  the repository root. #111 updates fixture resolution and runs auth tests.
- `Frontend/server.py:1025` serves `ROOT / "dist"`, with ROOT the module directory.
  #113 must explicitly configure/resolve `apps/web/dist` in the combined image
  and test `/`, an emitted static asset, and SPA fallback as well as `/health`;
  a healthy gateway alone does not prove the built browser is served.
- `src/agents/contracts/export_schema.py:13` derives docs output from
  `parents[3]`. After relocation that points inside `apps/agent-api/src`, not the
  repository. #112/#114 supply an explicit output directory or repository-root
  helper and verifies output stays at `docs/api/agent-contract` from an installed
  invocation. Do not derive resource/output paths from new package depth.
