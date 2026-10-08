# Device routing: local failure and opt-in long-distance trial

Tracking: [issue #81](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/81),
[SPEC-020/AC-08–09](../docs/specs/SPEC-020-housing-controls-roommate-discovery.md).

## Live verification

Destination read from the existing PostGIS rental dataset:
`86bc747b-e4a1-5329-8fb9-9e0da76781f6`, Hanoi.
Origins below are known public city-center coordinates used as route inputs,
**not fabricated or injected browser GPS**. No user coordinates were inspected.

| Case | Result | Provider time including local throttle | Road connection gaps |
|---|---|---|---|
| HCM origin, no public consent | HTTP 422 `OUTSIDE_ROUTING_AREA` | No external fallback | No route fabricated |
| Hanoi center → actual rental | 10.4 km, ~12 min | 636 ms | 16.2 / 0.5 m |
| HCM center → same Hanoi rental | 1,495.4 km, ~1,138 min | 1,316 ms | 50.3 / 0.5 m |
| Hai Phong center → same rental | 107.7 km, ~77 min | 463 ms | 1.3 / 0.5 m |

Three explicit public requests with bounded 500 m snapping returned real OSRM
geometry and positive distance/duration, the same canonical Housing ID and
unchanged origin input. Snap gaps were all within the requested bound. Public
request starts are throttled; no reruns of these passed paid/network cases needed.
Times are this one run, not a latency guarantee. Duration is not live traffic.

Local command (opt-in sends only the script's public origins and real destination):

```powershell
cd 'Maps VN/LifeFlow'
$env:RUN_DEVICE_ROUTE_LIVE='1'
node scripts/check-device-routing.mjs
```

## Other verification

- LifeFlow TypeScript workspaces build: pass.
- Frontend build and 8 pure contract checks: pass.
- Shared contracts: 37 tests pass, including 3 new device-route validation tests.
- Browser actual denied-GPS flow + Housing controls/mobile: pass, 16.3 s; used the
  harness's own existing thread, no new LLM call, selected/revision unchanged.
- Gateway SQLite health and Ruff: pass.
- Gateway ASGI with the test-owned session and real Platform/PostGIS preserves
  `OUTSIDE_ROUTING_AREA` without public consent. No HTTP provider mock. A first
  check against production-local UI with a disposable harness session correctly
  returned 401 (different session databases); checking the harness's own gateway
  then verified the route outcome. No user account/session was modified.
- UI and Platform restarted and health ready; local config enables the public
  endpoint only for explicit consented device-route requests. `.env` is not committed.
- Normal local startup preflight passes for all six existing services. UI readiness
  accepts main's `{status:ok}` SQLite contract; old optional service marker retained
  only when returned. Removed the duplicate MapPanel resize observer so it does not
  interrupt fitting GPS/long route geometry.

## Remaining verification / limits

The user's original GPS position was not captured, so the exact laptop error
cannot be reproduced or attributed conclusively to positioning vs. local graph.
Actual device GPS happy path and checkbox/button workflow with a real permission
grant need manual browser acceptance; no injected location/provider replay used.
Pure validation tests do not substitute for that acceptance. Public routing can
still report no segment/no route, especially for inaccurate GPS or an approximate
home point. User must inspect the map rather than treating a drawn route as exact.

This does not resolve the integrated foundation's unrelated full-suite failures
listed in the PR #80 handoff. No deploy, no transactions, no automatic public
Housing commute/MCP calls, no new mock provider/tests.
