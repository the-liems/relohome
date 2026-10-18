# Roommate map ownership and contact actions

Issue: #255. Based on main `eedd7fc`.

## Cause and behavior

- `/roommate/map/rooms` explicitly included `owner_id == actor.id`. It now excludes the trusted authenticated viewer's own post. An owner cannot override identity through a request body. The gateway session identity, adult/terms opt-in, blocks, active status, expiry and location consent remain enforced.
- The yellow Roommate marker was only a badge on the housing UI. The card, quick detail and expanded detail still offered rental selection, comparison or landlord contact. These entries now offer **Contact poster**, linking to the existing Roommate profile and connection flow. Merely opening a profile does not send a request or disclose contact details.
- Several visible posters for the same listing open an explicit poster picker. No automatic first-poster choice. Opening this picker from expanded details replaces that dialog rather than stacking native modals; closing/navigating must not leave body scrolling locked.
- The expanded linked-room detail omits landlord decision/contact tools and host reviews, and explains that the entry is for finding a roommate, not renting the whole home. Directions and housing information remain available.
- The ordinary housing listing is independent of the Roommate post: hiding one's own yellow overlay does not delete or hide the base housing listing. A room with another eligible poster can still have a yellow overlay. Manage one's own Roommate post from My profile.

No new endpoint, model call, database migration, environment variable, automatic connection request or production data mutation.

## Verification

- Real temporary SQLite + ASGI Roommate suite: **209 passed, 10 skipped**. Includes owner-hidden / other-viewer-visible, two posters sharing one room, rejection of client identity override, blocked users, paused/revoked/expired posts and consent checks.
- Web contract suite: **50 passed**.
- Initial map cases plus existing gallery/shared-pin regressions: **12 browser case results passed**, desktop and mobile. Covers contact actions in list and both detail layers, VI/EN labels, the multi-poster picker, no housing selection/landlord-contact/connection mutations, normal housing selection when no overlay exists, and scroll restoration. The Windows runner remained in teardown after the cases finished and the owned Vite listener stopped; only that runner was interrupted.
- Existing connection/access regressions: **8 browser case results passed**, desktop and mobile: guest/disabled/age/terms gates, reviewed contact consent, in-app chat introduction, and uncertain-write reconciliation without duplicate sends. Same Windows runner teardown limitation.
- TypeScript and production Vite build pass. Ruff check/format for touched Python and `git diff --check` pass.
- Browser API responses are synthetic fixtures. No real users were contacted; no production profiles or bookings were changed. Production behavior still requires deployment of both agent-api and web, followed by a two-account smoke check.

## Deployment smoke check

1. Owner A publishes a room link with explicit public map-location consent. A does not see their own yellow overlay; their profile remains manageable in My profile.
2. Eligible viewer B sees A's yellow overlay. Card and both details offer Contact poster, not Select home or a landlord viewing request.
3. Contact poster opens A's Roommate profile. Only an explicit reviewed connection request proceeds through the existing flow.
4. Pause the post or block the other user; after the existing overlay refresh, the post disappears. A stale profile link must be rejected by the existing profile/connection checks.

## P2 review follow-up: overlay failures and viewing removal

- A failed refresh used to clear room markers and thereby restore rental selection. Availability and overlay reads now distinguish pending/unavailable from a successful empty response. The snapshot is bound to its exact listing scope, so an old empty response cannot authorize a new scope. Pending/failed reads disable selection and landlord tools in the card and both details; stale profile names and links are not retained. Directions and viewing removal remain available.
- Only a successful read (including a confirmed empty result), or an explicitly disabled Roommate service, restores normal rental actions. Retry continues to use the existing paused-poll/manual-retry policy, without automatic selections or writes.
- Verify all listing IDs in parallel batches of at most 250 rather than treating IDs beyond the first batch as ordinary housing without checking.
- A new Roommate overlay used to replace the viewing-selection removal action. **Remove selection** is now separate from Contact poster and unavailable-state controls, on the card, quick detail and expanded detail. Existing read-only/busy/removability rules still apply; removing a viewing choice does not choose another home or send a connection request.
- Additional desktop/mobile regressions cover HTTP 503 after a known Roommate post, initial availability and overlay failures, pending retry, recovery to an authoritative empty result, viewing removal after an overlay appears (healthy and failing), and coverage beyond 250 listings. Expanded detail actions wrap on small screens. No changes to backend behavior or production data.
- Follow-up verification: **24 browser case results passed**, **50 contract tests passed**, **9 related API tests passed**, and TypeScript/Vite build plus diff checks passed. Inspected the mobile screenshot showing Contact poster and Remove selection side by side. The same Windows runner teardown limitation applies; no staging/production writes were made.
