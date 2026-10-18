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
- New map cases plus existing gallery/shared-pin regressions: **12 browser case results passed**, desktop and mobile. Covers contact actions in list and both detail layers, VI/EN labels, the multi-poster picker, no housing selection/landlord-contact/connection mutations, normal housing selection when no overlay exists, and scroll restoration. The Windows runner remained in teardown after the cases finished and the owned Vite listener stopped; only that runner was interrupted.
- Existing connection/access regressions: **8 browser case results passed**, desktop and mobile: guest/disabled/age/terms gates, reviewed contact consent, in-app chat introduction, and uncertain-write reconciliation without duplicate sends. Same Windows runner teardown limitation.
- TypeScript and production Vite build pass. Ruff check/format for touched Python and `git diff --check` pass.
- Browser API responses are synthetic fixtures. No real users were contacted; no production profiles or bookings were changed. Production behavior still requires deployment of both agent-api and web, followed by a two-account smoke check.

## Deployment smoke check

1. Owner A publishes a room link with explicit public map-location consent. A does not see their own yellow overlay; their profile remains manageable in My profile.
2. Eligible viewer B sees A's yellow overlay. Card and both details offer Contact poster, not Select home or a landlord viewing request.
3. Contact poster opens A's Roommate profile. Only an explicit reviewed connection request proceeds through the existing flow.
4. Pause the post or block the other user; after the existing overlay refresh, the post disappears. A stale profile link must be rejected by the existing profile/connection checks.
