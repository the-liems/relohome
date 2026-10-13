# AhaMove staging runbook

For independent Docker images, HTTP MCP and Coolify handoff, use
[Moving container runbook](moving-containers.md). The instructions below retain
the original local stdio workflow. Credentials may stay in the repository root
`.env.local`; the startup command passes it to the server with `node --env-file`.

## Security prerequisite

Revoke any credential that appeared in a screenshot, chat message, log or commit.
Create a new staging key/token and place it only in the repository-root `.env.local`.

## Configure

Run `npm run dev:init` at the repository root and provide either:

- `AHAMOVE_USER_TOKEN`, or
- both `AHAMOVE_API_KEY` and `AHAMOVE_MOBILE`.

Keep these controls for read-only verification:

```env
AHAMOVE_ENV=staging
AHAMOVE_WRITE_ENABLED=false
AHAMOVE_RATING_ENABLED=false
AHAMOVE_PRODUCTION_ENABLED=false
```

Configure `AHAMOVE_WEBHOOK_SECRET` only after agreeing on the callback
authentication mode with AhaMove.

## Build and migrate

```powershell
npm ci # repository root
# From repository root
npm run db:up
npm run db:migrate
npm run build
```

## Start processes

```powershell
npm run dev:moving-api
npm run dev:moving-mcp
```

The Moving API liveness endpoint is `http://127.0.0.1:4200/health`; database and
webhook readiness is `/ready`. This MCP entrypoint uses stdio
and writes protocol output only to stdout; diagnostics go to stderr.

## MCP client configuration

```json
{
  "command": "node",
  "args": [
    "--env-file=<repository>/.env.local",
    "<repository>/apps/moving-mcp/dist/server.js"
  ]
}
```

## Mock-free live verification

Live tests never create provider response fixtures. After configuring a rotated
credential and a running migrated database:

```powershell
$env:RUN_AHAMOVE_STAGING_INTEGRATION='1'
npm run test:moving:live
Remove-Item Env:RUN_AHAMOVE_STAGING_INTEGRATION
```

This command first verifies AhaMove directly (cities, services and service
detail), then starts the real Moving MCP process and verifies its tool catalog
and `list_service_areas` call.

The discovery test needs no hardcoded scenario. To exercise a real estimate,
also set operator-owned values for `AHAMOVE_TEST_SERVICE_ID`, pickup/destination
address, latitude, longitude, contact name and mobile. Optional values include
`AHAMOVE_TEST_TRACKING_NUMBER` and `AHAMOVE_TEST_PAYMENT_METHOD`. These values
belong only in the ignored local `.env.local`, never in test source or committed data.

Write/UAT scenarios require explicit real pickup and destination configuration,
review of expected charges, `AHAMOVE_WRITE_ENABLED=true`, and a stored approval.
Do not enable them in CI or execute them with personal contact data.

## Production gate

Production remains blocked until AhaMove staging UAT, webhook testing, golden
scenarios, secret review and an explicit production deployment decision pass.
