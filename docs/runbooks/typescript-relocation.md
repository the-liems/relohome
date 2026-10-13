# TypeScript relocation (#111)

The eight private TypeScript workspaces now live in `apps/` and `packages/`.
Install from repository root with Node 24/npm 11: `npm ci`, then `npm run build:ts`.
The single root lockfile retains external dependency versions and integrity hashes.

| Former path under Maps VN/LifeFlow | Canonical path / npm package |
| --- | --- |
| platform-api | apps/platform-api / @relohome/platform-api |
| mcp-server | apps/location-mcp / @relohome/location-mcp |
| moving-api | apps/moving-api / @relohome/moving-api |
| moving-mcp-server | apps/moving-mcp / @relohome/moving-mcp |
| packages/contracts | packages/contracts / @relohome/contracts |
| packages/housing-query | packages/housing-query / @relohome/housing-query |
| packages/mcp-core | packages/mcp-core / @relohome/mcp-core |
| packages/moving-service | packages/moving-service / @relohome/moving-service |

Root commands include `dev:api`, `dev:mcp`, `dev:mcp:http`, `dev:moving-api`,
`dev:moving-mcp`, `dev:moving-mcp:http`, `db:migrate`, the existing `db:import:*`
commands, and `moving:up/down/status/verify`. Per-service commands work with
`npm run <command> --workspace @relohome/<package>`. Root and nested Moving
commands both pass the repository-root `.env.local` with `--env-file`.

The legacy nested manifest contains only forwarding/operational scripts, no
workspace definitions or lockfile. Its identified consumers are the retained
PowerShell launchers, local Moving tooling, `scripts/live-checks.mjs`, and existing
runbooks. #115 owns retiring it together with those callers. There are no duplicate
source implementations or speculative old-name npm aliases. No new external
consumer was found in the repository scan; the private-consumer limitations of
[#118's assessment](../integration/monorepo-baseline/naming-inventory.md#external-consumers-and-identifiers-without-this-spelling)
still apply. Location exports are `ReloHomeMcpDependencies`,
`createReloHomeMcpServer`, and `createReloHomeMcpRuntime`, updated with all internal
callers. PR #107 telemetry is not merged in this base and is not relocated here.

## Retained assets and compatibility

The location slice (#115) moved SQL to `deploy/database/`, the map demo to
`examples/map-app/`, Streamlit to `examples/location-streamlit/`, scripts to
`scripts/relohome/`, and location/Moving infrastructure to `deploy/location/`
and `deploy/moving/`. Data, `.env`, `.runtime` and routing assets retain their
existing paths. Never move credentials or databases to `apps/`.

Services and shared packages read no `.env` file themselves (#130, #133): each
npm script passes repository-root `.env.local` explicitly. Existing process
variables win. Relative importer values from the platform npm workspace retain
the former workspace base; explicit launcher working directories retain their
meaning. Local SQL resolves under `deploy/`, reports under `eval/location/`;
images retain `/app/database` and `/app/reports`. Keep `runtime-paths.test.ts`
and both migration-image first-run/rerun checks as gates.

Docker uses repository-root contexts and allowlists. Its disposable manifest/lock
adapter preserves `/app/{platform-api,mcp-server,moving-api,moving-mcp-server,packages}`;
image-local TypeScript configs reflect that depth. Image commands and SQL paths,
service/DNS names, ports, health endpoints, volume/project/image identities,
environment names, MCP identifiers, persisted enums, migration history/locks, and
operational logs are unchanged (M10–M21/M24–M25). SQL files are byte-identical.

## Validation and rollback

```sh
npm ci
npm run build
npm run test:ts
npm run test:ts:database
npm run deployment:check
npm run image:check -- platform location moving-api moving-mcp location-migrate moving-migrate
```

The database runner requires Docker and access to the existing private PostGIS
image. It creates random test containers with tmpfs storage and ephemeral loopback
ports, imports synthetic POIs/administrative areas using the real importers, runs
all location suites including canonicalization, dataset roundtrip and POI v2, and
removes only its own container, including on SIGINT/SIGTERM cancellation.
Uncatchable termination such as SIGKILL still requires manual cleanup of that
run's container. It never connects to an existing database.
Provider-dependent Moving checks remain opt-in (`test:moving:live`).

The existing `scripts/test-migration-image.py <kind> <built-image>` verifies both
migration images against isolated databases, including repeat-run history and
runtime grants. Runtime liveness checks alone do not claim staging data continuity.

Rollback is a code revert plus redeployment of the previously published image
digest through the existing release process. Do not restore/reset a database,
rerun imports, regenerate credentials, or rename volumes to undo this move.
Windows launcher execution and staging existing-data/digest rollback require their
respective environments and remain explicit #116 evidence gates. No production
rollout is part of this change.

## Location assets follow-up (#115)

SQL now lives in `deploy/database/`; local Platform resourceRoot is `deploy/`
and Moving resolves `deploy/database/` directly. Images retain `/app/database`.
The resource-path regression still preserves old relative input paths. The
[location guide](../location/README.md) and
[validation evidence](../integration/location-relocation.md) cover examples,
launchers and unchanged state/Compose identities. The former source table above
remains historical context.
