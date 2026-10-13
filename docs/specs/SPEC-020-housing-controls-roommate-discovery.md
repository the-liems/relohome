# SPEC-020 — Housing controls and Roommate discovery

Status: Draft. Accountable owner: Khoa. Reviewers: Housing/Map and Roommate owners.
Tracking: [issue #79](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/79).
Routing follow-up: [issue #81](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/81).

## Scope and flow

Explicit UI controls complement natural-language domain agents, not replace them.
The Housing map supports an independent 2–4-home comparison basket. Pan/filter
changes do not silently remove basket entries. New workspace/search may reset the
basket; the durable selected home and original service plan are unaffected.
Comparison reads each selected home's provider detail in parallel, displays known
facts and unknown fields, and never changes the selected home or executes a booking.

Directions is an explicit consent-based browser action. A click requests a fresh
device location; the platform re-reads the canonical Housing destination and
computes the real local route. No LLM, chat history write, personal profile update,
invented origin or silently chosen city. GPS accuracy and approximate destination
are disclosed. Permission denial, GPS timeout, unsupported context, unavailable
route or out-of-coverage origin remain visible errors. The external source icon is
removed only from the map detail footer, not from factual provenance records.

Roommate shows real profiles and an explicit separate DEMO source. Real discovery
automatically loads a saved/default city once and reloads on city selection.
Criteria beyond the city are optional progressive disclosures. An empty real list
explains the absence and links to publishing or DEMO when enabled; DEMO is never
presented as actual residents or connections. Publishing/age/terms/contact consent
and all backend validation remain unchanged.

## Authoritative contracts

- `apps/web/src/housingInteraction.ts`: basket and coordinate validation.
- `apps/web/src/components/HousingDirections.tsx`: transient permission lifecycle.
- `packages/contracts/src/route.ts`: entity route contract.
- The same file owns the separate `DeviceRouteRequestSchema`/response for
  `/v1/routes/device`. Device routing never enables an agent/MCP external fallback.
- `packages/python/roommate/src/relohome_roommate/models.py`, `policy.py`, `demo.py`: real eligibility and DEMO boundary.
- [SPEC-019](SPEC-019-housing-comparison-isolation.md): comparison/choice isolation.

## Acceptance criteria

- AC-01: Add/remove up to four distinct observed homes; compare requires two. Full
  basket never prevents removing an entry. Current home and Moving remain intact.
- AC-02: Comparison concurrently reads canonical details; partial read errors are
  explained and stale list facts are not represented as newly verified facts.
- AC-03: No device location is requested until Directions is clicked. Cancel/unmount
  ignores late GPS results and cancels network requests. No location persistence.
- AC-04: Route origin is granted real device coordinates; destination is the real
  Housing ID. No fake location or straight line used as a provider road route.
- AC-05: No source-link icon in map detail footer. Source metadata remains intact.
- AC-06: Real discovery autoloads without publishing a profile or filling every
  field. City changes and pagination cancel obsolete reads. DEMO is explicitly
  labeled and never enters saved real profiles/contact/connection routes.
- AC-07: Desktop/mobile controls are accessible, compact and do not conceal the
  compare selection, search action or permission failures.
- AC-08: A granted coordinate with an unroutable road segment is not reported as
  denied GPS. Keep the coordinate visible on a map; preserve typed route errors.
  Default 100 m road snapping can increase to 500 m only through an explicit action;
  disclose actual snap distances and do not count off-road gaps as routed distance.
- AC-09: Clicking Directions selects local-first `routing_policy: auto`; no separate
  public-sharing checkbox. Preserve browser GPS permission and disclose third-party
  forwarding/logging before requesting location. Local coverage/connectivity/no-road
  failures may use one public driving attempt, including long/intercity routes.
  Re-read canonical Housing destination; preserve GPS and bounded road snapping.
  Unset config uses the approved provider; explicit empty disables it. Legacy
  requests without a policy remain local-only unless they explicitly select public.
  Bound requests/queue, preserve cancellation, and disclose best-effort reliability.
  See [ADR-024](../adr/ADR-024-auto-public-device-routing.md).

## Limits and non-goals

Browser geolocation requires HTTPS/localhost and explicit browser/OS permission;
accuracy is device-dependent. Local route coverage is the configured OSRM city
datasets, not all Vietnam. Public driving is a browser-only automatic fallback, not an
extension of AhaMove service availability or a live traffic/navigation guarantee.
No deployment, real transactions, generated replacement
profiles, fabricated location test fixtures, or accepted ADR in this change.

Reference: [MDN getCurrentPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).
Public provider: [FOSSGIS coverage, logging and usage policy](https://routing.openstreetmap.de/about.html).
