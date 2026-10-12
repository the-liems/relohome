# Entrypoint and import appendix

Baseline: `9b2b2dbddee8e55d7219be7de3348e815b1e50f4`. Generated from tracked source only.

Name declarations below are pinned evidence, not final naming decisions.
[The naming inventory](naming-inventory.md) feeds #118 before implementation.

## npm commands

Commands below run in the manifest directory; `npm run <name>` preserves the declared command.

### `Frontend/package.json`

Package: `siu-ai-web`

| Command | Definition |
| --- | --- |
| `postinstall` | `node scripts/prepare-map.mjs` |
| `predev` | `node scripts/prepare-map.mjs` |
| `prebuild` | `node scripts/prepare-map.mjs` |
| `dev` | `vite --host 127.0.0.1` |
| `build` | `tsc -b && vite build` |
| `preview` | `vite preview --host 127.0.0.1` |
| `test:e2e` | `playwright test` |

### `Maps VN/LifeFlow/map-app/package.json`

Package: `lifeflow-map-app`

| Command | Definition |
| --- | --- |
| `prepare:data` | `node scripts/prepare-poi.mjs "D:/Demo AI thực chiến/Maps VN/Extracts/accommodations.geojson" public/data/accommodations.geojson` |
| `prepare:worker` | `node scripts/copy-maplibre-worker.mjs` |
| `postinstall` | `npm run prepare:worker` |
| `predev` | `npm run prepare:worker` |
| `predev:lifeflow` | `npm run prepare:worker` |
| `prebuild` | `npm run prepare:worker` |
| `dev` | `vite` |
| `dev:lifeflow` | `vite --host 127.0.0.1 --port 5173` |
| `build` | `tsc -b && vite build` |
| `lint` | `oxlint src tests playwright.config.ts vite.config.ts` |
| `preview` | `vite preview` |
| `test:e2e` | `playwright test` |

### `Maps VN/LifeFlow/mcp-server/package.json`

Package: `@lifeflow/mcp-server`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `dev` | `tsx src/server.ts` |
| `dev:http` | `tsx src/http-server.ts` |
| `start` | `node dist/server.js` |
| `start:http` | `node dist/http-server.js` |
| `pretest` | `npm run build` |
| `test` | `vitest run tests` |

### `Maps VN/LifeFlow/moving-api/package.json`

Package: `@lifeflow/moving-api`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `dev` | `tsx src/server.ts` |
| `start` | `node dist/server.js` |
| `test` | `vitest run tests --passWithNoTests` |

### `Maps VN/LifeFlow/moving-mcp-server/package.json`

Package: `@lifeflow/moving-mcp-server`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `dev` | `tsx src/server.ts` |
| `start` | `node dist/server.js` |
| `dev:http` | `tsx src/http-server.ts` |
| `start:http` | `node dist/http-server.js` |
| `test:http` | `vitest run tests/http.live.test.ts` |
| `test` | `vitest run tests --passWithNoTests` |
| `test:live` | `vitest run tests/live.staging.test.ts` |

### `Maps VN/LifeFlow/package.json`

Package: `lifeflow-platform`

| Command | Definition |
| --- | --- |
| `build:moving` | `npm run build --workspace @lifeflow/contracts && npm run build --workspace @lifeflow/mcp-core && npm run build --workspace @lifeflow/moving-service && npm run build --workspace @lifeflow/moving-api && npm run build --workspace @lifeflow/moving-mcp-server` |
| `moving:up` | `npm run build:moving && node scripts/moving-stack.mjs up` |
| `moving:down` | `node scripts/moving-stack.mjs down` |
| `moving:status` | `node scripts/moving-stack.mjs status` |
| `moving:verify` | `node scripts/moving-stack.mjs verify` |
| `build` | `npm run build --workspace @lifeflow/contracts && npm run build --workspace @lifeflow/housing-query && npm run build --workspace @lifeflow/mcp-core && npm run build --workspace @lifeflow/moving-service && npm run build --workspace @lifeflow/platform-api && npm run build --workspace @lifeflow/mcp-server && npm run build --workspace @lifeflow/moving-api && npm run build --workspace @lifeflow/moving-mcp-server` |
| `test` | `npm run test --workspace @lifeflow/contracts && npm run test --workspace @lifeflow/housing-query && npm run test --workspace @lifeflow/mcp-core && npm run test --workspace @lifeflow/moving-service && npm run test --workspace @lifeflow/platform-api && npm run test --workspace @lifeflow/mcp-server && npm run test --workspace @lifeflow/moving-api && npm run test --workspace @lifeflow/moving-mcp-server` |
| `test:ci` | `npm run test --workspace @lifeflow/contracts && npm run test --workspace @lifeflow/mcp-core && npm run test --workspace @lifeflow/moving-service && npm run test --workspace @lifeflow/moving-api && npm run test --workspace @lifeflow/moving-mcp-server` |
| `db:up` | `docker compose --env-file .env -f infra/compose.yaml up -d postgis` |
| `db:stop` | `docker compose --env-file .env -f infra/compose.yaml stop postgis` |
| `db:migrate` | `npm run db:migrate --workspace @lifeflow/platform-api` |
| `mcp:up` | `docker compose --env-file .env -f infra/compose.yaml up -d --build location-mcp` |
| `mcp:stop` | `docker compose --env-file .env -f infra/compose.yaml stop location-mcp` |
| `db:import:places` | `npm run db:import:places --workspace @lifeflow/platform-api` |
| `db:import:pois:v2` | `npm run db:import:pois:v2 --workspace @lifeflow/platform-api` |
| `db:import:housing` | `npm run db:import:housing --workspace @lifeflow/platform-api` |
| `db:report:pois` | `npm run db:report:pois --workspace @lifeflow/platform-api` |
| `db:deduplicate:pois` | `npm run db:deduplicate:pois --workspace @lifeflow/platform-api --` |
| `db:import:areas` | `npm run db:import:areas --workspace @lifeflow/platform-api` |
| `dev:api` | `npm run dev --workspace @lifeflow/platform-api` |
| `dev:mcp` | `npm run dev --workspace @lifeflow/mcp-server` |
| `dev:mcp:http` | `npm run dev:http --workspace @lifeflow/mcp-server` |
| `dev:moving-api` | `npm run dev --workspace @lifeflow/moving-api` |
| `dev:moving-mcp` | `npm run dev --workspace @lifeflow/moving-mcp-server` |
| `dev:moving-mcp:http` | `npm run dev:http --workspace @lifeflow/moving-mcp-server` |
| `db:migrate:moving` | `node packages/moving-service/dist/migrate.js` |
| `test:moving:http` | `npm run test:http --workspace @lifeflow/moving-mcp-server` |
| `test:moving:native` | `node scripts/test-moving-native.mjs` |
| `test:moving:deployment` | `node scripts/verify-moving-deployment.mjs` |
| `test:moving:live` | `npm run test:live --workspace @lifeflow/moving-service && npm run test:live --workspace @lifeflow/moving-mcp-server` |
| `dev:map` | `npm run dev:lifeflow --prefix map-app` |

### `Maps VN/LifeFlow/packages/contracts/package.json`

Package: `@lifeflow/contracts`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `test` | `vitest run tests` |

### `Maps VN/LifeFlow/packages/housing-query/package.json`

Package: `@lifeflow/housing-query`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `test` | `vitest run tests` |

### `Maps VN/LifeFlow/packages/mcp-core/package.json`

Package: `@lifeflow/mcp-core`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `test` | `vitest run tests --passWithNoTests` |

### `Maps VN/LifeFlow/packages/moving-service/package.json`

Package: `@lifeflow/moving-service`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `test` | `vitest run tests` |
| `test:live` | `vitest run tests/live.staging.test.ts` |

### `Maps VN/LifeFlow/platform-api/package.json`

Package: `@lifeflow/platform-api`

| Command | Definition |
| --- | --- |
| `build` | `tsc -p tsconfig.json` |
| `dev` | `tsx src/server.ts` |
| `start` | `node dist/server.js` |
| `db:migrate` | `tsx src/migrate.ts` |
| `db:import:places` | `tsx src/import-places.ts` |
| `db:import:pois:v2` | `tsx src/import-pois-v2.ts` |
| `db:import:housing` | `tsx src/import-housing.ts` |
| `db:report:pois` | `tsx src/report-poi-coverage.ts` |
| `db:deduplicate:pois` | `tsx src/deduplicate-pois.ts` |
| `db:import:areas` | `tsx src/import-admin-areas.ts` |
| `test` | `vitest run tests` |

## Operational and example entrypoint files

All tracked script-directory files are included, including import-only helpers. Commands with provider/database effects are inventory, not authorization to execute.

- `Frontend/scripts/check-services.py`
- `Frontend/scripts/map-dialogue-live.mjs`
- `Frontend/scripts/prepare-map.mjs`
- `Makefile`
- `Maps VN/LifeFlow/Extract-Poi-V2.ps1`
- `Maps VN/LifeFlow/Setup-Routing.ps1`
- `Maps VN/LifeFlow/Start-LifeFlow.ps1`
- `Maps VN/LifeFlow/Stop-LifeFlow.ps1`
- `Maps VN/LifeFlow/demo/mcp_client.py`
- `Maps VN/LifeFlow/demo/streamlit_app.py`
- `Maps VN/LifeFlow/demo/tool_lab_app.py`
- `Maps VN/LifeFlow/map-app/scripts/copy-maplibre-worker.mjs`
- `Maps VN/LifeFlow/map-app/scripts/prepare-poi.mjs`
- `Maps VN/LifeFlow/scripts/check-device-routing.mjs`
- `Maps VN/LifeFlow/scripts/check-local-schema.mjs`
- `Maps VN/LifeFlow/scripts/inspect-moving-estimate.mjs`
- `Maps VN/LifeFlow/scripts/moving-stack.mjs`
- `Maps VN/LifeFlow/scripts/test-moving-native.mjs`
- `Maps VN/LifeFlow/scripts/verify-moving-ci.sh`
- `Maps VN/LifeFlow/scripts/verify-moving-deployment.mjs`
- `scripts/_pyrun.cmd`
- `scripts/_pyrun.sh`
- `scripts/check-ci-runner.sh`
- `scripts/deploy-coolify.py`
- `scripts/export-agent-registry.mjs`
- `scripts/generate-roommate-demo.py`
- `scripts/housing-geocode-apply.py`
- `scripts/housing-geocode-full.py`
- `scripts/housing-geocode.py`
- `scripts/import-teammate-snapshot.ps1`
- `scripts/init-local-integration.py`
- `scripts/local-integration.py`
- `scripts/log_antigravity.py`
- `scripts/log_hook.py`
- `scripts/log_manual.py`
- `scripts/log_privacy.py`
- `scripts/measure-read-latency.py`
- `scripts/normalize-housing-room-bedrooms.py`
- `scripts/repair_plan_history.py`
- `scripts/restore-local-snapshot.py`
- `scripts/setup-ci-python.sh`
- `scripts/setup.sh`
- `scripts/setup_hooks.ps1`
- `scripts/setup_hooks.sh`
- `scripts/smoke-agent-containers.py`
- `scripts/smoke-mcp-containers.sh`
- `scripts/start-local-mvp.ps1`
- `scripts/submit_log.py`
- `scripts/test-map-data.py`
- `scripts/test-map-dialogue-live.py`
- `scripts/verify-map-data.py`
- `src/agents/contracts/export_schema.py`
- `src/agents/llm_cli.py`
- `src/mcp_servers/flights/__main__.py`
- `src/mcp_servers/payments/__main__.py`
- `src/ui/agent_chat.py`
- `src/ui/flight_demo.py`
- `src/ui/map_picker.py`
- `src/ui/mvp_components.py`
- `src/ui/payment_demo.py`
- `tests/test_housing_geocode.py`
- `tests/test_mcp_servers_layout.py`
- `tests/test_prompt_hooks.py`

## Test-only ASGI entrypoints

- `Frontend.tests.roommate_test_server:app` → `tests.browser_gateway.roommate_test_server:app` (18503).
- `Frontend.tests.runtime_gateway_audit_server:app` → `tests.browser_gateway.runtime_gateway_audit_server:app` (18504 runtime audit, 18505 workspace repairs, 18506 search scope, 18509 housing controls).
- The current configs hard-code `..\\.venv\\Scripts\\python.exe` and `--app-dir ..`; #110/#113 must provide a platform-aware installed Python invocation and preserve per-run temporary state/provider gates.
- `Maps VN/LifeFlow/platform-api/src/clean-pois.ts` is a standalone operational CLI outside package scripts; target `apps/platform-api/src/clean-pois.ts`.

## Cross-root Python import evidence

Includes static and function-local imports; dynamic subprocess/module strings still require the path-reference audit below.

| Consumer | Imported module |
| --- | --- |
| `Frontend/roommate_gateway.py` | `src.roommate.media` |
| `Frontend/scripts/check-services.py` | `src.services.adapters.mcp` |
| `Frontend/scripts/check-services.py` | `src.services.adapters.registry` |
| `Frontend/server.py` | `Frontend.roommate_gateway` |
| `Frontend/server.py` | `Frontend.store` |
| `Frontend/server.py` | `src.agents.intake` |
| `Frontend/server.py` | `src.mcp_servers.flights.schemas` |
| `Frontend/server.py` | `src.models.moving_options` |
| `Frontend/server.py` | `src.models.schemas` |
| `Frontend/server.py` | `src.roommate.access` |
| `Frontend/server.py` | `src.roommate.agent_projection` |
| `Frontend/server.py` | `src.roommate.media` |
| `scripts/generate-roommate-demo.py` | `src.agents.subagents.services.location` |
| `scripts/generate-roommate-demo.py` | `src.roommate.demo` |
| `scripts/generate-roommate-demo.py` | `src.roommate.policy` |
| `scripts/generate-roommate-demo.py` | `src.services.adapters.registry` |
| `scripts/measure-read-latency.py` | `src.agents.common` |
| `scripts/measure-read-latency.py` | `src.agents.contracts` |
| `scripts/measure-read-latency.py` | `src.agents.graph` |
| `scripts/measure-read-latency.py` | `src.agents.models` |
| `scripts/measure-read-latency.py` | `src.agents.subagents.services.domain_tools` |
| `scripts/measure-read-latency.py` | `src.agents.subagents.services.location` |
| `scripts/measure-read-latency.py` | `src.main` |
| `scripts/measure-read-latency.py` | `src.services.adapters.mcp` |
| `scripts/measure-read-latency.py` | `src.services.adapters.registry` |
| `scripts/repair_plan_history.py` | `src.agents.graph` |
| `scripts/repair_plan_history.py` | `src.agents.progress` |
| `scripts/repair_plan_history.py` | `src.agents.wiring` |
| `scripts/repair_plan_history.py` | `src.services.adapters.registry` |
| `src/agents/deps.py` | `src.services.adapters.fakes` |
| `src/agents/deps.py` | `src.services.adapters.ports` |
| `src/agents/graph.py` | `src.agents` |
| `src/agents/intake_llm.py` | `src.roommate.models` |
| `src/agents/llm_components.py` | `src.services.adapters.registry` |
| `src/agents/llm_context.py` | `src.roommate.agent_projection` |
| `src/agents/nodes/transaction.py` | `src.services.adapters.ports` |
| `src/agents/subagents/capabilities.py` | `src.roommate.models` |
| `src/agents/subagents/remote.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/common.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/flight.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/location.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/moving.py` | `src.models.moving_options` |
| `src/agents/subagents/services/moving.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/moving_catalog.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/moving_llm.py` | `src.models.moving_options` |
| `src/agents/subagents/services/moving_llm.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/payment.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/read_llm.py` | `src.services.adapters.mcp` |
| `src/agents/subagents/services/roommate.py` | `src.roommate.access` |
| `src/agents/subagents/services/roommate.py` | `src.roommate.models` |
| `src/agents/subagents/services/roommate.py` | `src.roommate.ports` |
| `src/agents/subagents/services/roommate.py` | `src.roommate.services.access` |
| `src/agents/subagents/services/roommate.py` | `src.roommate.services.discovery` |
| `src/agents/wiring.py` | `src.checkout.service` |
| `src/agents/wiring.py` | `src.checkout.store` |
| `src/agents/wiring.py` | `src.checkout.viewing` |
| `src/agents/wiring.py` | `src.config` |
| `src/agents/wiring.py` | `src.mcp_servers.payments.settings` |
| `src/agents/wiring.py` | `src.services.adapters.commit` |
| `src/agents/wiring.py` | `src.services.adapters.fakes` |
| `src/agents/wiring.py` | `src.services.adapters.moving_approval` |
| `src/agents/wiring.py` | `src.services.adapters.registry` |
| `src/agents/wiring.py` | `src.services.adapters.sqlite_runtime` |
| `src/api/checkout.py` | `src.checkout.models` |
| `src/api/moving_quotes.py` | `src.agents.cost` |
| `src/api/moving_quotes.py` | `src.agents.deps` |
| `src/api/moving_quotes.py` | `src.agents.graph` |
| `src/api/moving_quotes.py` | `src.agents.intake` |
| `src/api/moving_quotes.py` | `src.agents.models` |
| `src/api/moving_quotes.py` | `src.agents.nodes.change_impact` |
| `src/api/moving_quotes.py` | `src.agents.nodes.cost_summary` |
| `src/api/moving_quotes.py` | `src.agents.nodes.respond` |
| `src/api/moving_quotes.py` | `src.agents.nodes.validator` |
| `src/api/moving_quotes.py` | `src.agents.planning` |
| `src/api/moving_quotes.py` | `src.agents.subagents.services.moving` |
| `src/api/moving_quotes.py` | `src.models.schemas` |
| `src/api/roommate_access.py` | `src.roommate.access` |
| `src/api/roommate_access.py` | `src.roommate.api_models` |
| `src/api/roommate_access.py` | `src.roommate.connection_repository` |
| `src/api/roommate_access.py` | `src.roommate.policy` |
| `src/api/roommate_access.py` | `src.roommate.ports` |
| `src/api/roommate_access.py` | `src.roommate.profile_repository` |
| `src/api/roommate_access.py` | `src.roommate.services.access` |
| `src/api/roommate_connections.py` | `src.roommate.api_models` |
| `src/api/roommate_connections.py` | `src.roommate.services.consent` |
| `src/api/roommate_connections.py` | `src.roommate.services.contacts` |
| `src/api/roommate_connections.py` | `src.roommate.services.inbox` |
| `src/api/roommate_connections.py` | `src.roommate.services.requests` |
| `src/api/roommate_discovery.py` | `src.roommate.api_models` |
| `src/api/roommate_discovery.py` | `src.roommate.services.access` |
| `src/api/roommate_discovery.py` | `src.roommate.services.discovery` |
| `src/api/roommate_map.py` | `src.roommate.api_models` |
| `src/api/roommate_map.py` | `src.roommate.models` |
| `src/api/roommate_map.py` | `src.roommate.policy` |
| `src/api/roommate_map.py` | `src.roommate.ports` |
| `src/api/roommate_map.py` | `src.roommate.services.access` |
| `src/api/roommate_media.py` | `src.roommate.api_models` |
| `src/api/roommate_media.py` | `src.roommate.media` |
| `src/api/roommate_media.py` | `src.roommate.models` |
| `src/api/roommate_profiles.py` | `src.roommate.api_models` |
| `src/api/roommate_profiles.py` | `src.roommate.models` |
| `src/api/roommate_profiles.py` | `src.roommate.services.access` |
| `src/api/roommate_profiles.py` | `src.roommate.services.discovery` |
| `src/api/roommate_profiles.py` | `src.roommate.services.profiles` |
| `src/api/roommate_profiles.py` | `src.roommate.views` |
| `src/api/roommate_safety.py` | `src.roommate.api_models` |
| `src/api/roommate_safety.py` | `src.roommate.services.access` |
| `src/api/roommate_safety.py` | `src.roommate.services.moderation` |
| `src/api/roommate_safety.py` | `src.roommate.services.safety` |
| `src/api/routes.py` | `src.agents.common` |
| `src/api/routes.py` | `src.agents.graph` |
| `src/api/routes.py` | `src.agents.intake` |
| `src/api/routes.py` | `src.agents.models` |
| `src/api/routes.py` | `src.agents.progress` |
| `src/api/routes.py` | `src.agents.selections` |
| `src/api/routes.py` | `src.agents.wiring` |
| `src/api/routes.py` | `src.models.schemas` |
| `src/api/routes.py` | `src.services.adapters.mcp` |
| `src/api/sandbox_payments.py` | `src.services.adapters.mcp` |
| `src/api/viewings.py` | `src.agents.graph` |
| `src/api/viewings.py` | `src.agents.models` |
| `src/api/viewings.py` | `src.agents.nodes.change_impact` |
| `src/api/viewings.py` | `src.agents.nodes.cost_summary` |
| `src/api/viewings.py` | `src.checkout.models` |
| `src/api/web_actions.py` | `src.agents.common` |
| `src/api/web_actions.py` | `src.agents.graph` |
| `src/api/web_actions.py` | `src.agents.models` |
| `src/api/web_actions.py` | `src.agents.nodes.change_impact` |
| `src/api/web_actions.py` | `src.agents.nodes.cost_summary` |
| `src/api/web_actions.py` | `src.agents.progress` |
| `src/api/web_actions.py` | `src.agents.selections` |
| `src/api/web_actions.py` | `src.agents.subagents.services.location` |
| `src/api/web_actions.py` | `src.agents.suggestions` |
| `src/api/web_actions.py` | `src.services.adapters.mcp` |
| `src/checkout/service.py` | `src.agents.common` |
| `src/checkout/service.py` | `src.agents.models` |
| `src/checkout/service.py` | `src.mcp_servers.flights.booking_engine` |
| `src/checkout/service.py` | `src.mcp_servers.flights.schemas` |
| `src/checkout/service.py` | `src.models.moving_options` |
| `src/checkout/service.py` | `src.services.adapters.mcp` |
| `src/checkout/viewing.py` | `src.agents.common` |
| `src/checkout/viewing.py` | `src.config` |
| `src/checkout/viewing.py` | `src.services.adapters.mcp` |
| `src/main.py` | `src.agents.wiring` |
| `src/main.py` | `src.api.checkout` |
| `src/main.py` | `src.api.moving_quotes` |
| `src/main.py` | `src.api.roommate_access` |
| `src/main.py` | `src.api.roommate_connections` |
| `src/main.py` | `src.api.roommate_discovery` |
| `src/main.py` | `src.api.roommate_map` |
| `src/main.py` | `src.api.roommate_media` |
| `src/main.py` | `src.api.roommate_profiles` |
| `src/main.py` | `src.api.roommate_safety` |
| `src/main.py` | `src.api.routes` |
| `src/main.py` | `src.api.sandbox_payments` |
| `src/main.py` | `src.api.viewings` |
| `src/main.py` | `src.api.web_actions` |
| `src/main.py` | `src.config` |
| `src/main.py` | `src.roommate.runtime` |
| `src/models/moving_options.py` | `src.agents.intake` |
| `src/roommate/runtime.py` | `src.config` |
| `src/services/adapters/commit.py` | `src.agents.common` |
| `src/services/adapters/commit.py` | `src.agents.models` |
| `src/services/adapters/commit.py` | `src.models.moving_options` |
| `src/services/adapters/commit.py` | `src.models.schemas` |
| `src/services/adapters/fakes.py` | `src.agents.common` |
| `src/services/adapters/fakes.py` | `src.agents.memory` |
| `src/services/adapters/fakes.py` | `src.agents.models` |
| `src/services/adapters/mcp.py` | `src.mcp_servers.flights.catalog` |
| `src/services/adapters/ports.py` | `src.agents.models` |
| `src/services/adapters/registry.py` | `src.agents.models` |
| `src/services/adapters/sqlite_runtime.py` | `src.agents.common` |
| `src/services/adapters/sqlite_runtime.py` | `src.agents.memory` |
| `src/services/adapters/sqlite_runtime.py` | `src.agents.models` |
| `src/services/llm.py` | `src.config` |
| `src/ui/flight_client.py` | `src.ui` |
| `src/ui/flight_demo.py` | `src.mcp_servers.flights.catalog` |
| `src/ui/flight_demo.py` | `src.mcp_servers.flights.schemas` |
| `src/ui/flight_demo.py` | `src.mcp_servers.flights.search.serpapi` |
| `src/ui/flight_demo.py` | `src.mcp_servers.flights.settings` |
| `src/ui/payment_client.py` | `src.ui` |
| `src/ui/payment_demo.py` | `src.mcp_servers.payments.privacy` |
| `src/ui/payment_demo.py` | `src.mcp_servers.payments.schemas` |
| `src/ui/payment_demo.py` | `src.mcp_servers.payments.settings` |
