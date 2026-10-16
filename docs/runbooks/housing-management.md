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
| `VIETMAP_API_KEY` | Server-only Autocomplete v4 and Place v4 for property location confirmation. |
| `HOUSING_MODERATOR_IDS` | Comma-separated trusted account IDs that may verify posters and approve properties and listings. |
| `HOUSING_MESSAGE_RATE_PER_MINUTE` | Optional, default 10. Messages one sender may post per minute in a tenant–landlord conversation. |
| `HOUSING_VIEWING_PROPOSAL_DAYS` | Optional, default 7 (1–60). How many days ahead a landlord may propose replacement viewing times. Set the same value on the backend (agent API) and the platform API. |
| `HOST_TERMS_VERSION` | Optional. Empty: no poster-terms step. A value makes posters accept that version before adding homes. |
| `HOUSING_REVIEW_MIN_COUNT` | Default 1. Minimum visible reviews for a host rating; shared by Platform and Location MCP. |
| `HOUSING_REVIEW_PATTERN_DAYS` | Default 90. Recent review edit/publication window for low-rating evidence. |
| `HOUSING_REVIEW_LOW_STARS` | Default 2. Maximum star value considered low. |
| `HOUSING_REVIEW_PATTERN_PROPERTIES` | Default 2. Minimum distinct properties for an alert. |
| `HOUSING_REVIEW_PATTERN_AUTHORS` | Default 3. Minimum independent authors for an alert. |
| `SIU_PLATFORM_API_URL` | Platform API base, normally `http://127.0.0.1:4100/v1` on a host. |
| `SIU_PUBLIC_BASE_URL` | Public HTTPS origin used for uploaded listing image URLs. |
| `RELOHOME_RUNTIME_ROOT` | Absolute existing checkout/deployment root for the installed gateway and operator CLIs; `/app` in the web image. |
| `SIU_WEB_DB` | Account/session SQLite path, relative to runtime root or absolute; Coolify uses `/app/data/siu-web.sqlite3` on `web-data`. |

Run `npm run db:migrate` at repository root before starting the new workspace.
Migrations `013_housing_product_v1.sql`, `014_housing_host_profiles.sql` and `015_housing_viewing_requests.sql`, `016`, `017_housing_contact_messages.sql` are additive and grant the
application role only the writes needed by the owner workflow.
Migration `018_housing_landlord_reviews.sql` adds reviews, reports and host flags. Run migrations before deploying the review UI or the new detail reader; no backfill or demo scores are created.

## Media storage

The gateway validates JPEG/PNG input, strips metadata and writes normalized PNG
files under `Frontend/data/housing-media`, relative to `RELOHOME_RUNTIME_ROOT`
(override with `SIU_HOUSING_MEDIA_DIR`). This is the preserved local data path,
not a Python source namespace. Coolify explicitly uses `/app/data/housing-media`
on `web-data`; backup uses the gateway's same configured paths. Production deployments must mount that
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

Admins sign in through `/admin` using the separate Admin login entry. The
landlord workspace has no moderation tab; browser moderation requires an Admin
session and backend permission on every operation. A moderator cannot approve a property
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
# From repository root
npm run build --workspace @relohome/contracts
npm run build --workspace @relohome/housing-query
npm run build --workspace @relohome/platform-api
node node_modules/vitest/vitest.mjs run apps/platform-api/tests/housing-management.test.ts --pool=threads --maxWorkers=1
# Needs a migrated local PostGIS (DATABASE_URL / ADMIN_DATABASE_URL); creates and removes its own test rows.
node node_modules/vitest/vitest.mjs run apps/platform-api/tests/housing-management.integration.test.ts --pool=threads --maxWorkers=1

cd apps/web
npm run build
npx playwright test tests/browser/housing-product.spec.ts --project=desktop
```

For gateway tests, use the project virtual environment and a writable pytest temp
directory. Tests use HTTP fixtures and do not create real listings.

## Cloud release and publication guards

See [the cloud runbook](housing-cloud.md) for persistent volumes, operator account
provisioning, backup/restore, HTTPS and rollout order. Migration 023 is additive;
previously reviewed inventory is preserved. New managed listings require complete
content, valid photos and a confirmed provider location. Important edits invalidate
approval transactionally; stale submissions/reviews receive 409. Uploaded images
are private until the listing is public. Legacy reviewed properties without a host
profile retain their previous publication; editing them still requires the current
profile/location workflow before reapproval. Imported records retain their original
identities and coordinate accuracy.
