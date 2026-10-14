# Tenant–landlord handoff

This extends the existing viewing workflow, Platform API/PostGIS, Agent ledger and authenticated browser gateway. Customer and Landlord still share the existing account; Admin login remains separate.

## Viewing

The landlord confirms the requested time or supplies at least one replacement slot within the next seven days. Replacement choices come from the Agent's configured slot window, lead time and duration; the tenant's calendar intersects those suggestions with currently available slots. A crafted request outside the proposals is rejected by the gateway and Platform API. Old declined requests without proposals show no slots until the landlord supplies replacements. A changed proposal or booking invalidates stale revisions.

The existing `HOUSING_VIEWING_TEST_VISIT_ANYTIME` setting only bypasses the viewing clock in allowed environments. Booking and landlord confirmation remain required for managed homes.

## Reported transfer

The tenant's “Báo đã trả chủ nhà” is a manual transfer report, not a bank payment verification. After the tenant agrees on a home with a confirmed viewing, the gateway stores their report in the existing Agent ledger and sends its stable report key, amount, date and agreement to PostGIS. A failed delivery stays visible and can be retried without creating another report.

Only an active property manager can confirm receipt or reject a pending report with a reason. A rejection leaves the agreement open so the tenant can submit a corrected report with a new key. Confirmation closes the contact request and marks that listing rented; existing visibility rules remove it from public Search, Map and Housing MCP results. The report and contact are locked together; concurrent decisions cannot both succeed. Pending/confirmed reports prevent rescheduling, withdrawal and manual completion shortcuts.

Older ledger reports use their existing transaction ID as the delivery key. Closed historic requests are preserved; the system does not invent a new landlord confirmation or reopen them.

## Messages and inbox

The floating messenger is shared across customer and landlord workspaces. Messages carry authenticated sender IDs, and the browser checks its expected session ID before reads/writes. The server derives the conversation role from the authenticated participant and blocks new self-contacts. Test tenant and landlord in separate browser profiles or one normal and one private window; tabs in the same profile share the login cookie.

The messenger launcher is a bell-only tab flush with the lower right edge at the same height in customer and landlord workspaces. Both controls use the existing accent/on-accent colors in light and dark themes. The conversation list leads with the other participant’s account name; the open header reads “Listing title – Participant name”. Platform derives the participant from an authorized contact, and the gateway enriches only those responses from existing account names. No email, phone, user-directory endpoint or database migration is added for this display.

Notifications poll every ten seconds; an open conversation polls every fifteen seconds. New messages and viewing/payment updates have unread indicators. This MVP does not require WebSockets or another service.

“Xóa khỏi hộp thư” creates a per-manager archive entry only for completed/cancelled requests, with no pending transfer report. Tenant history, messages and transfer evidence remain accessible. Existing data and migrations are not rewritten.

## Deployment on Coolify

Run the standard migration image/command with the admin database role before starting the updated Platform API, Agent API and Web/gateway release. New additive migrations: `024_housing_contact_handoff.sql` and `025_housing_location_privacy_documents.sql`. The existing migration runner grants the application role SELECT and the required INSERT/UPDATE access to the new tables. Platform health reports `migration_required` until the payment-report and property-document tables exist. Build/deploy the shared contracts and Housing Query with Platform, Location MCP, Agent API and Web/gateway; restart these services together so cached results use the current projection.

No new secrets, services, environment variables or hardcoded test-mode values are introduced. Preserve the existing PostGIS and Web/Agent volumes, including the gateway housing-media mount and its new `private-documents` subdirectory. Private document files require the gateway runtime user to retain read/write access; never expose that directory through a public bucket or static mount. Back up the existing database and SQLite state before release using the repository's existing backup process. Admin provisioning and Vietmap/Coolify configuration remain documented in issues #140 and #159.

## Validation against main

Base: `c82dcfb7d2441a1d0b7398ca0297fbf81f128b18` (includes merged PRs #146, #154, #156, #157 and #158). The shared App imports were reconciled with PR #146; its design and active-chat changes are retained.

- Full Python: 1,053 passed, 103 skipped, 136 subtests passed.
- Disposable PostGIS: 65 Housing Query tests, 64 Platform tests and 7 Location MCP tests passed. Housing management API writes use the application role, with a separate admin connection only for fixtures/cleanup.
- Frontend contracts: 45 passed.
- Housing/viewing browser suites: 50 desktop/mobile cases passed; final changed workflows were rerun successfully, including sending messages at 320×568.
- The broader `app.spec.ts` suite has 34 failing cases. All 34 reproduce on the unmodified base main with the same test names; both branches pass its other 86 cases. Those failures cover existing welcome layouts and housing/flight/moving workspace expectations. This change does not claim that the entire app browser suite is green.
- Local PostGIS and SQLite/key backups were taken before migration 024. The migration ran twice successfully, and existing housing rows were compared before/after with no changes. Runtime checks returned HTTP 200 for all eight local services. Admin login/queue returned 200; moderation from the ordinary workspace returned 403.

An existing managed contact keeps its confirmation requirement when a listing becomes hidden. Its transfer report can still reach the landlord through private contact history. Public visibility changes do not rewrite or erase that history.

The user requested local testing before opening a PR. No PR, remote push, main merge or cloud deployment is part of this local handoff.

Latest bell/name update: 33 housing gateway tests, 56 housing/viewing desktop/mobile browser cases, and the disposable PostGIS suites passed. Platform and Web production builds passed.

Host profiles are requested when the first home is added and reused for subsequent homes. Merely entering the landlord workspace no longer forces onboarding. Saving the first profile continues into the home form. Admin's pending-profile queue includes its own profile with `can_review: false` and disabled actions; backend self-verification remains forbidden. Pending-profile/location counters link to the identity queue. Admin refreshes on focus and every fifteen seconds; landlord profile status refreshes on the same triggers. No existing profile is automatically approved or rewritten.

Profile-flow validation: 28 housing-product desktop/mobile cases passed, followed by 8 final changed-flow cases including stale-form revision protection. Disposable PostGIS passed 65 Housing Query, 65 Platform and 7 Location MCP tests. Both production builds passed. The real local Admin queue now shows its one existing pending own profile with self-review disabled; the profile remains pending and no moderation decision was applied. Updated assets are served on ports 8503 and 8504.

## Location privacy and landlord product update

Address typing loads Vietmap suggestions. After selecting an address, the owner supplies apartment/floor/building details and adjusts the entrance pin on the existing street map, by dragging, map click, arrow keys or coordinates. Confirmation signs the final coordinate, address and provider locality for the current user; changed inputs require a new confirmation. The server rejects forged/expired tokens, another user's token and a pin more than 2 km from the selected lookup. The full address and exact canonical geometry remain available to authorized managers/Admin and internal spatial filtering. Optional ownership/business proof is sanitized JPEG/PNG, up to 5 MB, served through a separately authorized private endpoint. PDF upload is not included.

Public managed listings use ward/district/city and a stable per-property area with a 500 m radius. The display center is shifted 300–450 m using a private random database seed, keeping the real entrance within the circle without revealing it as its center. Search, detail, map markers/clusters, Housing MCP and AI candidates share this projection. Exact geometry remains the basis for search and commute constraints. Public commute data excludes route geometry/snap distances and rounds distances/times; explicit housing routes resolve the approximate public center. Older saved cards, conversation snapshots, viewing and checkout responses receive the same read-time masking without rewriting stored history. Imported listings retain their existing behavior. Multiple rooms at one location remain separate listings.

Reference: [Airbnb's location setup](https://www.airbnb.com/resources/hosting-homes/a/how-to-add-your-location-358) describes pin adjustment and general public location; the 500 m radius here is the user's demo requirement. Vietmap integrations retain the existing [Autocomplete V4](https://maps.vietmap.vn/docs/map-api/autocomplete-version/autocomplete-v4/) and [Place V4](https://maps.vietmap.vn/docs/map-api/place-v4/) endpoints.

Room details and listing content now share one form. A complete room/listing can be saved as a draft or sent for review; sending remains available on return. Metadata, room and costs save in one database transaction, with actor-scoped request deduplication and revision checks. Photo upload uses the existing validated flow; retrying an upload does not create a second room. Existing publication validation still requires valid images, verified host/location and Admin review. Important changes invalidate publication.

Reopening an existing home supplies separate lookup and full-address confirmation tokens. A no-op address save preserves existing metadata/confirmation time and publication; a changed pin/address requires confirmation and review. The four operational dashboard counters open properties, all rooms, vacant rooms and contact requests. The inbox opens property cards, then room cards, then viewing/transfer requests; calendar deep links open the corresponding room. Payment responses refresh without losing the selected room. Closed-request archiving, replacement viewing times, sender identities and edge bell behavior remain available.

Current verification for this update: the full Python suite passed 1,056 tests (103 skipped, 136 subtests passed); the final historical privacy regression suite passed 35 gateway tests. Disposable PostGIS passed 65 Housing Query, 66 Platform and 7 Location MCP tests using the real application role. All 70 unique housing/viewing desktop/mobile cases passed. The full final run passed 69; one page reload timed out with a blank Vite page in the parallel build/browser run. Both desktop/mobile variants passed on isolated rerun. All 45 frontend contracts passed. TypeScript and Web production builds passed. This does not change the 34 previously documented broad app-suite failures that reproduce on base main.

Before applying migration 025 locally, a fresh PostGIS/SQLite/key/media backup was verified. Migration ran twice; all pre-existing housing rows and exact canonical addresses/coordinates were compared before/after and remained unchanged. Backup and local health evidence are recorded outside Git in `data/local-pr-integration/product-privacy-*-validation.json`.
