# Housing map: scope and interactions — 2026-10-12

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Issue: [#119](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/119).
Branch: `fix/housing-map-scope-interactions`, based on `main` (`481288a`).

## Changes and causes

1. **Unexpected ward/air conditioning**: cross-goal user memory could prefill old constraints even when a new search named the same city. A new explicitly scoped Housing query no longer silently inherits district, nearby anchor, budget, room type or amenities from that memory. Stated constraints win. Intake still handles conversational refinements; unspecified searches can still use remembered preferences. This is a structured memory policy, not keyword routing or a replacement for Intake/Planner/domain LLM.
2. **Gray dots and aggregation**: gray circles came from the POI cluster layer. That layer is removed; individual POI symbols use collision handling. Housing requests explicitly opt out of backend aggregation, with one feature per listing at its actual source coordinate. Exactly coincident pins offer a choice list on click; nearby coordinates are not grouped, rounded or moved artificially. Existing limits and truncation remain: a zoomed-out map is not a promise to display the whole market.
3. **POI details**: clicking a rendered amenity opens its actual name, category and available address/contact/opening-hour fields. Missing information is not invented. Links retain URL validation. No extra LLM call.
4. **Return to chat**: a stronger, high-contrast `Về hội thoại` button with a back arrow and at least 44px height. Mobile filters are collapsible so they do not cover the whole map; returning to chat remains outside the collapsed controls.
5. **House cards**: click the card background/price/stats/address or press Enter/Space on the focused card to open details. Save, select, compare and directions buttons retain independent actions. Opening a house and opening a POI are mutually exclusive; a late house response cannot reopen a closed card.
6. **Wrong administrative scope**: named sub-areas must match the complete normalized name and, if stated, the administrative unit. `Quận 5` is not `Phường 5` or `Phường 15`. Bare `Cầu Giấy` may use the dataset's actual `Phường Cầu Giấy`. City bounds exclude same-name areas from another city. Ambiguity remains a clarification rather than a similarity-score auto-choice. Both the domain tool session and the Location search/viewport path use the same check.

## Current data limitation

The actual local catalog has city polygons for Hà Nội, TP.HCM and Đà Nẵng, and current ward polygons including Cầu Giấy and Hoàng Mai. It does **not** have a polygon for the former **Quận 5**. Searching legacy district addresses still works inside the known city scope, but the UI truthfully reports the missing boundary and does not draw a fake envelope or substitute a ward. Showing the exact Quận 5 outline requires importing a verified boundary with the correct identity/version.

No database migration, dataset replacement, roommate shutdown, order, payment, staging configuration change or automatic deployment is part of this fix.

## Contract and deployment

`HousingMapRequest` gains optional `cluster: boolean`. `false` returns bounded individual listing features at the requested zoom. Omitted/true retains existing aggregation behavior for other clients. The viewport, filters, pagination and response schema are unchanged.

Deploy the updated contracts/housing-query (Platform) and frontend together, plus the updated agent API for the memory/scope policy. An old strict Platform schema rejects the new `cluster` field; shipping only the frontend is not sufficient. No global CI/concurrency configuration was changed. Review and required Linux CI must precede merge; merging code does not itself prove staging has deployed it.

## Verification

| Check | Result |
| --- | --- |
| Ruff `src/ tests/` | Pass |
| Frontend TypeScript/Vite build | Pass |
| LifeFlow workspace TypeScript build | Pass (8 workspaces) |
| Python application/backend/frontend tests, Windows-compatible subset | 807 passed, 96 skipped, 64 subtests passed |
| Contracts + housing-query unit tests, excluding DB integration files | 65 passed |
| Frontend scope/staging-context/housing-controls contracts, desktop | 15 passed |
| Actual browser interactions, desktop + mobile | Pass: whole-card/keyboard detail, independent comparison, POI hit-test/detail, no gray cluster layer, return to conversation |
| Actual MCP/PostGIS/Platform read tests | 6 passed: Hà Nội under 5m, Cầu Giấy, Hanoi Hoàng Mai, TP.HCM, Đà Nẵng, legacy Quận 5 |
| Two real LLM searches in a disposable local account, separate threads | First: Hoàng Mai + AC + under 5m; second: Hà Nội + under 5m only. Second Intake has no prefilled district/amenity; city scope is Hà Nội |

The Python subset excludes four Linux/bash/container test files on native Windows (`test_ci_runner`, `test_ci_container_smoke`, `test_ci_images`, `test_web_image_layout`) and `test_prompt_hooks`. The latter has two existing POSIX-path home-redaction subtest failures on Windows even with UTF-8 enabled; it is not rewritten in this Housing PR. This is **not** a claim that the entire GitHub CI has passed. Live read tests are opt-in, and skipped external integration tests are not counted as passes.

The browser harness observes the real MapLibre instance and rendered-feature hit testing without replacing API/provider responses, geolocation or map methods' behavior. Follow-up browser runs reuse the disposable test thread; they do not rerun paid chat unnecessarily. All unit fixtures are separate from live catalog evidence.

### Repeat focused checks

```powershell
# Repo root, environment and read-only local services configured normally
.venv/Scripts/python.exe -m ruff check src/ tests/
.venv/Scripts/python.exe -m pytest tests/test_agents/ -q

# Maps VN/LifeFlow
npm.cmd run build
npx.cmd vitest run packages/contracts/tests packages/housing-query/tests --exclude '**/*.integration.test.ts'

# Frontend
npm.cmd run build
npx.cmd playwright test tests/browser/scope-contracts.spec.ts tests/browser/staging-context.contracts.spec.ts tests/browser/housing-controls.contracts.spec.ts --project=desktop --workers=1
```

Live scope tests: `RUN_HOUSING_MAP_SCOPE_LIVE=1`, with the normal Location MCP authentication and Platform URL available to the test process; run `tests/test_llm_agents/test_housing_map_scope_live.py`.

Live browser test: `RUN_HOUSING_MAP_INTERACTIONS_LIVE=1`, local gateway on port 8503 and Playwright Vite proxy on 5174; run `tests/browser/housing-map-interactions.live.spec.ts` in Frontend. Without `HOUSING_MAP_INTERACTIONS_THREAD` this registers a disposable local test account and performs the two read-only LLM searches. With that variable, only a previously created disposable verification account is accepted; no personal cookies should be pasted into commands or logs.

## Manual acceptance

- Start a new chat with `Tìm phòng ở Hà Nội dưới 5 triệu đồng mỗi tháng` after a prior Hoàng Mai/AC search. Confirm no inherited ward or amenity chip.
- Zoom out/in: no gray POI clusters or regional housing grouping labels. Zoom in to inspect amenity icons and click one.
- Click a house's price, address or blank card background; detail opens. Save/compare/directions must not also open detail.
- Open/close mobile filters and the house sheet; return to conversation stays accessible.
- Search Cầu Giấy, Hoàng Mai in Hanoi, TP.HCM and Đà Nẵng: use real catalog geometry only. Search `Quận 5 TP.HCM`: no wrong ward polygon; display the unavailable-boundary explanation.

Existing threads can retain explicitly confirmed historical constraints/results. The memory fix does not erase user history; test a new query/thread when checking cross-goal prefill behavior.
