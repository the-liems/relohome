# Housing location clarification recovery

Issue #252. Started on main `8fa254a`; integrated and reverified main `eedd7fc`.

## Confirmed report and boundaries

The reported turn extracted `near=Ocean Park 1` and `max_price_vnd=5000000`
without missing constraints. The fast retrieval adapter stopped at location
resolution; its outer `search_housing_and_return` name was not proof that a
housing query had been executed. It used zero domain-model calls.

The user then supplied production map-search responses for `Ocean Park 1` and
`Vinhomes Ocean Park`. Neither returned the intended residential development:
all eight results per response were fuzzy matches, with maximum scores about
0.444 and 0.538 respectively. They include unrelated businesses/Grand Park and
Ocean Park parking, mall and bus-stop POIs. The existing 0.8 fuzzy-suggestion
threshold correctly rejects them. Reducing that threshold, aliasing a mall to
the development, inferring coordinates from airport hints or silently removing
the named scope would not fix the report safely.

The first complete public-POI response is retained as a regression fixture:
`tests/fixtures/location/ocean-park-1-production-resolution.json`. It contains
no account, thread, request or credential data. POI provenance/attribution:
OpenStreetMap contributors; each record retains its source URL.

The resolver output alone does not prove that the source database has no relevant
row: ingestion coverage, category, status, role exclusions or naming can explain
it. Inspect the actual deployed catalog before inserting/aliasing any entity.
`scripts/relohome/diagnose-location-name.sql` is an operator-run **read-only**
diagnostic for that check. It was not run against production by this PR.

## Code changes

- Scope recovery recognizes `ở khu`, `trong khu`, `tại khu`, `khu đô thị`,
  `khu dân cư` and the existing
  `khu vực` phrasing. This only enables a catalog lookup; it does not manufacture
  a polygon, relax exact-name checks or override a latest explicit `gần` request.
- Additive `Question.reason` distinguishes `location_not_found` and
  `location_ambiguous` from a missing text input. Question deduplication preserves
  the provider's reason and keeps structured choices authoritative.
- Location failures expose `data.location_resolution` with field, status and
  candidate/offered counts. No raw provider payload is added to model context.
  Statuses distinguish empty matches, below-threshold suggestions, ambiguity and
  missing coordinates for a selected housing landmark.
- Generic forms do not reopen for typed location-resolution questions. Existing
  responses without `reason` also stay in chat when the current location field
  is already populated or the question has location options/choices.
- Truly missing form fields still work; mixed questions retain the location
  explanation and show a form for the other supported question.
- Place selection accepts the existing bare `near`/route fields and their
  `property.`/`map.` prefixes, passing the real provider ID through `place_choice`.
- Housing not-found text asks for a fuller address and states that other search
  criteria remain intact. It does not promise an unavailable pin-picker action.

## Verification and delivery

- Agent suite: 617 passed, 1 skipped, including the real-response fixture
  through the adapter and fast retrieval path with zero model calls and no
  housing search using unrelated coordinates. The fixture preserves all eight
  UI results; the domain test uses its first five, matching the domain tool limit.
- A two-turn real graph test with mocked semantic Intake and provider confirms
  that adding the city preserves the landmark, price and typed resolution reason;
  only the existing Intake calls occur, with no planner or property-model call.
- Frontend contracts: 54 passed (52 default cases and two map-follow-up cases).
- Browser regressions: 12 passed (eight new cases and four existing map-follow-up
  cases, desktop/mobile), covering typed and legacy responses, a repeated
  unresolved reply after adding city, namespaced provider choices and mixed questions.
- Web TypeScript/production build passed. Ruff checks/format and diff whitespace
  checks cover the touched Python source/tests.
- The Windows browser-test runner hung during teardown after all 12 case results
  and the Vite listener stopped; only that completed runner was interrupted.
- No new model call, geocoder integration, API key, migration or environment
  variable. The additional area lookup is within existing provider-call budgets.
- Deploy agent-api and web together after review/merge. This PR does not deploy,
  write production data, or establish that Ocean Park 1 can now resolve live.
- For automatic correct discovery of that development, catalog remediation still
  requires a verified canonical source/location or boundary and verified aliases.
  No bus-stop/mall location or synthetic test coordinate may be used as a substitute.
  Issue #252 remains open for that outstanding data investigation.
