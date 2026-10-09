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
| `HOUSING_MODERATOR_IDS` | Comma-separated trusted account IDs that may verify posters and approve properties and listings. |
| `HOST_TERMS_VERSION` | Optional. Empty: no poster-terms step. A value makes posters accept that version before adding homes. |
| `SIU_PLATFORM_API_URL` | Platform API base, normally `http://127.0.0.1:4100/v1` on a host. |
| `SIU_PUBLIC_BASE_URL` | Public HTTPS origin used for uploaded listing image URLs. |

Run `npm run db:migrate` in `Maps VN/LifeFlow` before starting the new workspace.
Migrations `013_housing_product_v1.sql`, `014_housing_host_profiles.sql` and `015_housing_viewing_requests.sql` are additive and grant the
application role only the writes needed by the owner workflow.

## Media storage

The gateway validates JPEG/PNG input, strips metadata and writes normalized PNG
files under `Frontend/data/housing-media` (override with `SIU_HOUSING_MEDIA_DIR`). Production deployments must mount that
directory on persistent storage and include it in backup/restore. Files use random
identifiers and are served with `nosniff`; listing media stays pending until the
listing is reviewed.

## Publication workflow

0. In owner mode the account fills a poster profile (owner, authorized manager, broker or business).
   A moderator verifies it outside the app (phone/video call or in person) and records only the method;
   no ID images or numbers are stored. Unverified posters can prepare drafts, but their properties and
   listings cannot be approved. Poster suspension is not enabled (pending a team decision).
1. An owner creates a property. Its management membership starts as `pending`.
2. The owner may prepare units and draft listings while verification is pending.
3. A moderator activates the property membership.
4. The owner submits a draft listing for review.
5. A moderator approves or rejects it. Approval publishes only a `vacant` listing.
6. The owner changes availability independently to `vacant`, `rented` or `paused`.
7. Hiding or deleting a listing immediately removes it from public Housing reads.

Moderators use the "Duyệt tin" tab in `/landlord`; it appears only when the
queue endpoint accepts the signed-in account. A moderator cannot approve a property
or listing they manage. Self-service listings are stored with `source_type = 'user'`
and `attributes.self_service = true`, so public reads keep the existing contract.

Viewing times booked in the tenant's "Xem nhà" tab for owner-managed listings are synced by the gateway
into the landlord inbox, where the landlord confirms or declines them; other listings stay in test mode.

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
# Needs a migrated local PostGIS (DATABASE_URL / ADMIN_DATABASE_URL); creates and removes its own test rows.
node node_modules/vitest/vitest.mjs run platform-api/tests/housing-management.integration.test.ts --pool=threads --maxWorkers=1

cd ../../Frontend
npm run build
npx playwright test tests/browser/housing-product.spec.ts --project=desktop
```

For gateway tests, use the project virtual environment and a writable pytest temp
directory. Tests use HTTP fixtures and do not create real listings.
