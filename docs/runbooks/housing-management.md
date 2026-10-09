# Housing management runbook

## Scope

The Housing management extension adds an owner workspace at `/landlord`. Existing
Housing search, map, selection, viewing, Moving, Flight and Roommate contracts are
unchanged. Imported Housing records remain read only. Owner-created records use
the same PostGIS schemas and only become public after moderation.

## Required configuration

| Variable | Purpose |
| --- | --- |
| `AGENT_API_TOKEN` | Shared server secret used by the browser gateway and Platform API. Never expose it to JavaScript. |
| `HOUSING_MODERATOR_IDS` | Comma-separated trusted account IDs that may approve properties and listings. |
| `SIU_PLATFORM_API_URL` | Platform API base, normally `http://127.0.0.1:4100/v1` on a host. |
| `SIU_PUBLIC_BASE_URL` | Public HTTPS origin used for uploaded listing image URLs. |

Run `npm run db:migrate` in `Maps VN/LifeFlow` before starting the new workspace.
Migration `013_housing_product_v1.sql` is additive and grants the application role
only the writes needed by the owner workflow.

## Media storage

The gateway validates JPEG/PNG input, strips metadata and writes normalized PNG
files under `Frontend/data/housing-media`. Production deployments must mount that
directory on persistent storage and include it in backup/restore. Files use random
identifiers and are served with `nosniff`; listing media stays pending until the
listing is reviewed.

## Publication workflow

1. An owner creates a property. Its management membership starts as `pending`.
2. The owner may prepare units and draft listings while verification is pending.
3. A moderator activates the property membership.
4. The owner submits a draft listing for review.
5. A moderator approves or rejects it. Approval publishes only a `vacant` listing.
6. The owner changes availability independently to `vacant`, `rented` or `paused`.
7. Hiding or deleting a listing immediately removes it from public Housing reads.

Browser users never provide their own upstream actor ID. The gateway derives it
from the HttpOnly session and forwards it with the trusted server token.

## Analytics

The dashboard reads only recorded `detail_view`, `save` and `contact_request`
events. When no event window exists, the UI shows an empty measurement state. Do
not seed or synthesize production counters.

## Verification

```powershell
cd "Maps VN/LifeFlow"
npm run build --workspace @lifeflow/contracts
npm run build --workspace @lifeflow/housing-query
npm run build --workspace @lifeflow/platform-api
node node_modules/vitest/vitest.mjs run platform-api/tests/housing-management.test.ts --pool=threads --maxWorkers=1

cd ../../Frontend
npm run build
npx playwright test tests/browser/housing-product.spec.ts --project=desktop
```

For gateway tests, use the project virtual environment and a writable pytest temp
directory. Tests use HTTP fixtures and do not create real listings.
