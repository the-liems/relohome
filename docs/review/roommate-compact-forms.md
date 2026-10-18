# Roommate: compact forms

Issue: #247. Baseline: main at `64cbd80`.

## Visible changes

- Discovery keeps city and the search action upfront. Optional personal criteria
  and roommate filters live under one **Refine results** disclosure. The active
  preference count stays visible while it is collapsed.
- The profile editor separates **About you** and **Location and budget** with
  22px headings. Labels and text controls are 16px, including when shared control
  CSS would otherwise make them smaller. The search heading is 24px.
- Name and introduction share a row on desktop; controls stack on mobile.
  The introduction uses two rows and retains its existing 1,000-character limit.
- Budget maximum and cost basis come first. Minimum budget remains available in
  a small disclosure, initially expanded when an existing non-zero value exists.
- Removed the duplicated move-in heading and visually hid the redundant outer
  fieldset legend; its accessible name remains available to screen readers.
- Lifestyle, roommate preferences and optional map linking are grouped under
  **Additional information**, with a count of provided optional items.

## Preserved behavior

- No backend, schema, matching, API payload, required-field or default-value changes.
- City-only browsing remains available without publishing a profile.
- Collapsed controls stay mounted. Hiding them does not clear values, reset false
  booleans, downgrade hard preferences or infer unknown facts.
- `FormDisclosure` opens enclosing disclosures on native invalid events before
  the browser focuses a required/invalid control. Partially completed optional
  fields therefore cannot silently block submission while hidden.
- City changes still reset area preferences and linked-room consent. Switching
  away from having a room still clears the room link.
- Room-location consent and the separate preview/publication confirmation remain
  explicit. Neither opening a section nor saving an introduction publishes it.

## Verification

- Web TypeScript/production build: passed.
- Frontend contracts: 50 passed.
- Full `roommate.spec.ts` + `roommate-production.spec.ts`, desktop/mobile:
  **78 passed, 2 failed**. All 12 newly added cases passed.
- The two existing `responsive, keyboard and accessibility ... clean console`
  cases fail their empty-console assertion with `ERR_NETWORK_ACCESS_DENIED` and
  preload warnings. Both failures were reproduced on unchanged main `64cbd80`
  in a separate worktree with the same configuration; they are not reported as
  regressions introduced by this change. No assertion was removed or relaxed.
- New cases cover the compact visible field count, actual computed font sizes,
  private preview, preserved positive minimum/false values/hard preferences/room
  consent, hidden-field validation and focus, saved search filters and explicit
  clearing, keyboard disclosure activation, VI/light and EN/dark accessibility,
  and mobile overflow. Existing room-picker consent and account-intro cases pass.
- Desktop/mobile screenshots were inspected. Tests use synthetic intercepted API
  responses, not real user data or production writes.
- Local Windows Playwright runners finished all case results but hung during
  teardown. Only those runners were interrupted after their Vite listeners had
  stopped. No test failures were hidden by that interruption.

## Delivery

Deploy the web image after merge. No migration, environment variable, backend
deployment or new dependency is required. No live production acceptance or
cross-browser Safari/Firefox check is claimed.
