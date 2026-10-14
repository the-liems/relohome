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

Run the standard migration image/command with the admin database role before starting the updated Platform API, Agent API and Web/gateway release. New additive migrations: `024_housing_contact_handoff.sql`, `025_housing_location_privacy_documents.sql` and `026_housing_activity_notifications.sql`. The existing migration runner grants the application role SELECT and the required INSERT/UPDATE access to the new tables. Platform health reports `migration_required` until the payment-report and activity-event tables exist. Build/deploy the shared contracts and Housing Query with Platform, Location MCP, Agent API and Web/gateway; restart these services together so cached results use the current projection.

No new secrets, services, environment variables or hardcoded test-mode values are introduced. Preserve the existing PostGIS and Web/Agent volumes, including the gateway housing-media mount. Existing private document files from the local experiment remain preserved but their UI/API is removed in this release. Back up the existing database and SQLite state before release using the repository's existing backup process. Admin provisioning and Vietmap/Coolify configuration remain documented in issues #140 and #159.

## Earlier baseline validation

The historical checks in this section used base `c82dcfb` (PRs #146, #154, #156, #157 and #158). Current main integration is `1ea058c`, including PRs #163, #165 and #166 plus observability updates; current results are recorded below. The shared App imports were reconciled with PR #146; its design and active-chat changes are retained.

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

## Current product behavior

The address lookup, location preview and public Search/Map/Housing MCP projection match current main again. Entrance-pin adjustment, public privacy circles and supporting-document upload/read UI/API were removed at the user's request. Existing exact addresses/coordinates and previously applied additive migration 025 remain untouched, avoiding a destructive rollback or broken migration history. Its private seed/document storage is unused by the active product. Multiple rooms sharing coordinates retain main's distinct listings and its coincident-marker count. The unified room/listing form and draft/review buttons remain.

Property and room inbox cards are larger and show a red top-right number: distinct requests needing attention, not the number of messages in a request. Pending viewing confirmation, a pending transfer report, unread messages and unread contact updates qualify. The hierarchy remains Property → Room → Request; calendar and notification links open the corresponding request. Ordinary conversation messages remain attributed to their authenticated sender.

Migration 026 adds durable `activity_events` and per-user `activity_reads`. Database triggers record viewing requests/confirmations/proposed alternatives/cancellations, transfer reports/decisions and host/property/listing moderation transitions in the same transaction as the state change. Current open work is seeded once so existing requests appear in the bell. System updates are distinct from human messages, include the property/room, and appear in the contact conversation timeline with an action link. A click marks that event read and navigates to the relevant owner inbox, tenant viewing plan or Admin moderation record. Backend participation/management/moderator checks protect listing, timeline and acknowledgment; entering the ordinary workspace does not allow Admin feeds. Admin can view a pending own profile/notification while self-approval remains forbidden. The existing shared lower-right bell also runs in the Admin workspace, without adding a new service or WebSocket dependency.

The notification wrapper stays mounted when a guest signs in, preserving main's draft/map and recoverable guest claim. Tenant destinations resolve through an authenticated Agent lookup and gateway ownership check; the browser does not choose another account's thread. Link failures do not silently open an unrelated plan.

The visible viewing outcomes are “Đã gặp, đồng ý” and “Đã gặp, không đồng ý”. Both open a required 1–5 star review with optional comments before recording the outcome. For managed homes, the existing Platform review API publishes/updates the property review; imported-home feedback remains in the existing viewing ledger. An agreement continues into the existing rent/deposit decision form. A rejection saves feedback, drops the home and synchronizes withdrawal of its appointment. The gateway still requires a booked and landlord-confirmed appointment for managed homes; test mode only skips the clock. It checks the appointment/time before writing a review. Successful retry recognition prevents duplicate review/outcome operations after a lost response. Legacy outcomes/history remain readable, and an existing visited home prompts for review when proceeding to an agreement. Managed-home decision requests also require an existing, non-withdrawn review on the backend.

Current validation: full Python 1,161 passed, 103 skipped and 136 subtests passed; 94 desktop/mobile browser cases passed covering landlord, viewing/review, activity navigation, guest login, gallery and coincident pins. Disposable PostGIS suites passed 65 Housing Query, 66 Platform and 7 Location MCP cases using the application role; 46 frontend contracts passed; new tests cover request deduplication, participant-only events/reads and Admin notifications with self-review forbidden. TypeScript and Web production builds passed. Earlier broad app-suite baseline limitations remain documented above; this report does not claim every unrelated browser suite is green.

Main integration conflicts were resolved locally in gateway, App, map imports and translations. Current main's guest gates, galleries, marker behavior and observability configuration remain intact. No PR, push, main-branch merge or cloud deployment is authorized by this update. Fresh PostGIS/SQLite/key/media backup and before/after housing/canonical-place comparison are recorded outside Git in `data/local-pr-integration/activity-data-validation.json`; runtime evidence is in `activity-smoke-validation.json`.
