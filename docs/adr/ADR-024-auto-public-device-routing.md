# ADR-024 — Browser directions: local-first, automatic public fallback

Date: 2026-10-11. Status: Proposed / awaiting PR review.
Owner: Khoa; reviewers: Map/API, UI, privacy/security and deployment owners.

## Context and decision

The user revised the UX decision in ADR-023: clicking Directions should not
require a second public-provider checkbox. The browser still requests real device
geolocation permission. Before that prompt, the dialog explains that local routing
is preferred and, when unavailable/outside coverage, the two coordinates are sent
to FOSSGIS, which logs requests. Policy/fix-map links remain visible. No coordinates
go to LLM, profile or chat history.

The modern browser sends `routing_policy: auto` to `/v1/routes/device`. Server policy:

- `auto`: try local coverage; fallback once for outside coverage, local offline,
  no route/segment, or a local attempt timeout. Local budget 2.5 s.
- `local`: local only. Existing callers without a policy remain local unless their
  legacy `public_routing_consent=true` explicitly selected public.
- `public`: approved FOSSGIS driving endpoint directly.
- Never fallback after caller cancellation or an expired overall operation, for
  storage/unknown errors, invalid input or invalid provider evidence.
- Public fallback is specific to device-to-home browser routing. Agent/MCP routing,
  Housing commute and Moving service availability do not inherit it.

Far means outside the configured local road graph/coverage, not an arbitrary
kilometer threshold. Local NO_ROUTE can also reflect holes in the cropped graph;
public failure remains an error, never a fabricated route or a straight line.

Destination is re-read from the active canonical Housing listing, not a client
coordinate. Original GPS is preserved; default snapping remains 100 m. Increasing
snapping to 500 m still requires the existing explicit action; that is separate
from the removed public-sharing checkbox. Actual provider and snap gaps are shown.

## Configuration and limits

- Unset `OSRM_PUBLIC_DRIVING_URL` defaults to the approved HTTPS FOSSGIS driving
  endpoint. An explicitly empty value disables it. No client-selected provider URL.
- Coolify compose forwards this configuration to Platform; the previous compose
  omitted it. This is a confirmed configuration gap, not proof of deployed runtime
  settings or server egress; logs are still needed when staging fails.
- Public request timeout: 10 s; bounded queue delay: 4 s; request starts spaced at
  least 1.1 s **per RouteService process**; proper User-Agent; no public retries.
- Device operation deadline: 20 s including SQL; browser wait: 25 s. Disconnect
  aborts work. Existing general MCP deadlines/policies are unchanged.
- FOSSGIS is best-effort, no traffic feed or service guarantee. Per-process spacing
  is **not** a distributed rate limit. Before material multi-replica production use,
  enforce a global quota or use self-hosted/contracted routing. No Redis introduced
  in this fix and no deployment performed.

The product owner requested removal of the extra acceptance control; this ADR is
not a legal/compliance determination. Keep transparent disclosure and review the
published privacy notice and production provider choice with the team.

References: [FOSSGIS policy, logging and coverage](https://routing.openstreetmap.de/about.html),
[OSRM demo API usage policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy),
[issue #101](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/101).
