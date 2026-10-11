# ADR-023 — Opt-in public driving for device-to-home directions

Date: 2026-10-08. Status: Historical proposal; browser policy superseded by
[ADR-024](ADR-024-auto-public-device-routing.md) for review following the user's 2026-10-11 request.
Owner: Khoa; reviewers: Map/API, UI and privacy/security owners.

## Context

Local OSRM datasets cover three city regions. Device GPS can be outside those
regions or beyond the 100 m road-snapping limit. Removing a city bounds check does
not create the missing road graph. Khoa explicitly chose a public routing trial
with a separate coordinate-sharing consent instead of building a nationwide graph.

## Alternatives

1. Self-host nationwide OSRM: retains control over coordinates and capacity, but
   needs data preparation, storage and operational maintenance not in this task.
2. Silently forward failed routes to a public server: rejected; changes the data
   recipient without user consent and can create heavy automated query traffic.
3. Browser-only opt-in FOSSGIS driving endpoint: proposed for local evaluation.

## Proposed decision

- Add `/v1/routes/device` with canonical Housing ID and coordinate origin; do not
  expose public routing as an automatic agent/MCP or Housing commute fallback.
- No external call without `public_routing_consent=true`. UI requires a checkbox
  and a separate button with provider policy/logging disclosure. Closing the dialog
  discards component state; no profile, history or LLM location write.
- Public config is empty by default. The approved HTTPS FOSSGIS endpoint is
  allowlisted server-side; a browser cannot supply a provider URL.
- Serialize request starts at least 1.1 s apart within the single local process,
  bound queue delay/timeouts, no public retries or bulk tests. Set a valid User-Agent.
- Road snapping stays 100 m by default; user may explicitly allow 500 m at each
  endpoint. Do not replace input coordinates or fabricate off-road routing.
- Display real OSRM geometry/distance/time, actual snap gaps, OSM attribution and
  provider-policy/fix-map links. No claim of live traffic, available Moving booking,
  guaranteed navigation or accuracy of approximate listing addresses.

## Consequences

FOSSGIS receives coordinates and saves requests in logs. It has no reliability
guarantee for this application and forbids heavy use. Before deployment or multiple
replicas, choose a self-hosted/contracted provider and enforce a shared rate limit;
per-process demo throttling is not a distributed quota. This proposal supplements,
not supersedes, ADR-010's local Housing commute decision.

Related: [SPEC-020/AC-08–09](../specs/SPEC-020-housing-controls-roommate-discovery.md),
[issue #81](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/81),
[provider policy](https://routing.openstreetmap.de/about.html).
