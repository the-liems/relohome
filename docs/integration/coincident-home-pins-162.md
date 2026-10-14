# Coincident housing pins — issue #162

Base `main`: `331f03d`. Branch: `fix/162-coincident-home-pins`.

## Behavior

- Exactly equal source coordinates display one marker with a dynamic home count,
  e.g. **3 căn** (EN: **3 homes**), not one arbitrarily surviving price label.
  No approximate-location suffix or roommate text is appended to this counted label.
- Clicking it opens the separate homes; their IDs, original objects and coordinates
  remain intact. Selection, save, comparison and roommate colouring use individual IDs.
- Hover or selection highlights the shared marker without replacing its count by
  one home's price. A singleton retains the existing price label/roommate treatment.
- The open group's homes are derived from the current map response. Filtering
  from 3 to 2 or 1 updates both the count and list rather than retaining old cards.
- VI/EN changes update existing marker text; theme changes preserve geometry.

This is display grouping for **exact coordinate equality**, not proximity/grid
clustering. Nearby points are not rounded or combined; no gray aggregate dots,
artificial offsets, geocode calls, database mutations, backend/API contract or LLM
changes. Duplicate copies of the same listing ID cannot inflate the count.
The label follows the user's requested word “căn”; it counts unique returned
listing IDs and does not establish that the listings are distinct physical units
or accurate rooftop positions. Existing accuracy disclosures on cards remain.

## Verification and limitations

The browser fixture mounts the real React workspace and MapLibre with software
WebGL. It uses explicit synthetic homes, offline basemap and tiny synthetic SDF
glyphs solely for symbol-placement/hit testing, not real font appearance/provider
availability. These test-only modules are not imported into production builds.
Contracts cover ID deduplication, exact versus nearby coordinates, invalid points,
empty input and preservation of source objects/geometry. Browser regression checks
the actual rendered marker click, individual chosen ID, separate comparison cards,
hover/selection counts, VI/EN, light/dark and 3 -> 2 -> 1 filtering.

Basemap/provider failures and inaccurate geocode data are independent issues and
are not claimed fixed. No live provider calls, orders, payments or database writes.
The implementation is isolated in this worktree; root main/env/runtime and dirty
user files remain untouched. Merge/rebuild is needed before the currently running
main UI uses the new marker display.

Final checks: 45 pure frontend contracts passed; 4 browser cases passed (new pin
case plus existing map appearance regression, desktop and mobile). Web TypeScript /
Vite build, changed-file Prettier and diff whitespace checks passed. Initial fixture
runs failed due to an incorrect comparison button accessible name, a missing bounded
flex parent, and collapsed mobile filters; the fixture was corrected to use real
accessible controls and the production parent layout, not force-clicks or product CSS
changes. All final assertions run against actual MapLibre-rendered features.
The Windows Vite teardown hung after tests completed; only the verified test-server
process tree was stopped. The user's backend and UI processes were not restarted.
