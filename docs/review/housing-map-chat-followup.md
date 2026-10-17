# Housing map scope follow-ups (#228)

## Evidence and scope

The reported production task received `near="cầu giấy"`, `city="hà nội"`
and `max_price_vnd=5000000`. Its error was
`provider_unavailable: Database query timed out`, not an empty housing result.
A subsequent request displayed the full housing form, with the area in `near`.
The UI was configured to close any workspace without a fresh service result;
it also removed exact clarification question text when showing input controls.

This change fixes scope resolution and presentation. It does **not** claim to
identify or fix the production SQL statement that timed out. That needs query
timings/server evidence. No timeout increase, automatic retry, schema/index
migration, production environment edit or paid/live provider call is included.

## Changes

- Replace the existing Housing scope instruction with a similarly sized explicit
  correction example; preserve the Intake prompt-length regression budget.
- When a named administrative scope is mis-extracted into `near`, use its actual
  user request/merged goal to permit a real `search_areas` lookup. This is scope
  normalization inside the existing property service, not agent/tool routing.
  Only a unique full-name, non-fuzzy area with verified city containment (when a
  city is supplied) and a bounding box may supply a polygon. Explicit units stay
  explicit; partial names and other cities are not substitute boundaries.
- Keep explicit nearby/radius searches and API-confirmed points unchanged. If no
  matching area exists, the ordinary landmark resolver remains available; no
  coordinates/IDs or city are fabricated. Multiple matching areas ask the user.
- Apply the same catalog-backed handling when the full LLM tool loop explicitly
  prepares `near`. A polygon is not stored as a point anchor. Invocation-local
  memoization avoids repeating provider lookups on the wire when searching next.
- When a fresh named scope replaces the old one, prevent account memory from
  immediately putting the removed city back. The new scope resolves its own
  catalog parent; an explicitly stated city remains authoritative. Preserve
  other confirmed filters, such as the monthly budget. Update the old turn-rule
  test that relied on city re-prefill to match this deliberate safety behavior.
- Keep an already open map on same-thread, single-property change/refine replies
  with `ERROR`/`CLARIFY`. Snapshot only the previously mounted housing result;
  mark it as previous context and disable selecting its listings. Do not relabel
  it as new success or make historical results selectable. Successful new
  results update the existing map. Explicit exit, other threads, new goals,
  comparisons and other/mixed services retain normal navigation.
- Show backend errors and actual clarification questions/options in the map chat.
  Preserve location explanations when a full input form is appropriate elsewhere.
  No new model/classifier call, provider transaction or automatic retry is added.

## Offline verification

- Backend fixtures include the actual wrong `near` extraction, a three-turn
  Ocean Park 2 → Cầu Giấy → lower-budget graph sequence, stale city preferences,
  real nearby searches, ambiguous/partial/fuzzy/out-of-city areas, and the full
  `ReadLlmAgent` resolve → search loop with fake model/provider responses.
- Browser regression runs on desktop/mobile: error/clarification retains the
  exact map DOM, no full form replaces it, old selections are disabled, real
  question options work, success applies the new area filter and enables choice,
  and explicit exit still works. Existing housing/moving/flight smoke tests run.
- Pure UI contracts cover retention boundaries and preservation of location
  explanations; web TypeScript/Vite production build runs.

Fixtures are not live production geography or latency benchmarks. Once deployed,
verify a new production trace: the property result should contain the catalog's
actual narrow `administrative_area_ids`, the existing budget, and the resulting
`map_context.search_scope`/viewport. If a database timeout recurs, capture the
Location service request/query timings rather than treating it as no matches.

Local results: 668 backend agent/checkout tests passed, 1 skipped; 38 pure web
contract tests passed; 12 desktop/mobile browser smoke/regression tests passed;
web production build, changed-file Ruff checks and `git diff --check` passed.
