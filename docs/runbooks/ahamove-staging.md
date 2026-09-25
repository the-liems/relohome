# AhaMove staging runbook

## Security prerequisite

Revoke any credential that appeared in a screenshot, chat message, log or commit.
Create a new staging key/token and place it only in `Maps VN/LifeFlow/.env`.

## Configure

Copy `.env.example` to `.env` and provide either:

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
Set-Location "Maps VN/LifeFlow"
npm ci
npm run db:up
npm run db:migrate
npm run build
```

## Start processes

```powershell
npm run dev:moving-api
npm run dev:moving-mcp
```

The Moving API health endpoint is `http://127.0.0.1:4200/health`. MCP uses stdio
and writes protocol output only to stdout; diagnostics go to stderr.

## MCP client configuration

```json
{
  "command": "node",
  "args": ["<absolute-path>/Maps VN/LifeFlow/moving-mcp-server/dist/server.js"],
  "env": {
    "LIFEFLOW_ENV_FILE": "<absolute-path>/Maps VN/LifeFlow/.env"
  }
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

The discovery test needs no hardcoded scenario. To exercise a real estimate,
also set operator-owned values for `AHAMOVE_TEST_SERVICE_ID`, pickup/destination
address, latitude, longitude, contact name and mobile. Optional values include
`AHAMOVE_TEST_TRACKING_NUMBER` and `AHAMOVE_TEST_PAYMENT_METHOD`. These values
belong only in the ignored local `.env`, never in test source or committed data.

Write/UAT scenarios require explicit real pickup and destination configuration,
review of expected charges, `AHAMOVE_WRITE_ENABLED=true`, and a stored approval.
Do not enable them in CI or execute them with personal contact data.

## Production gate

Production remains blocked until AhaMove staging UAT, webhook testing, golden
scenarios, secret review and an explicit production deployment decision pass.
