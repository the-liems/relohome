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

Notifications poll every ten seconds; an open conversation polls every fifteen seconds. New messages and viewing/payment updates have unread indicators. This MVP does not require WebSockets or another service.

“Xóa khỏi hộp thư” creates a per-manager archive entry only for completed/cancelled requests, with no pending transfer report. Tenant history, messages and transfer evidence remain accessible. Existing data and migrations are not rewritten.

## Deployment on Coolify

Run the standard migration image/command with the admin database role before starting the updated Platform API, Agent API and Web/gateway release. New additive migration: `024_housing_contact_handoff.sql`. The existing migration runner grants the application role SELECT and the required INSERT/UPDATE access to the new tables. Platform health reports `migration_required` until the payment-report table exists.

No new secrets, services, environment variables or hardcoded test-mode values are introduced. Preserve the existing PostGIS and Web/Agent volumes. Back up the existing database and SQLite state before release using the repository's existing backup process. Admin provisioning and Vietmap/Coolify configuration remain documented in issues #140 and #159.
