# ReloHome landing page: visitor experience

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Issue: [#95](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/95).
Review: [PR #98](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/98).
Branch: `feat/95-landing-ux`, based on `main` at `e9c1df8`.

## Scope and source

Frontend presentation only. The current landing page, including its existing
hero image and seven service entries, is the reference supplied by Khoa. No new
website, hosting, backend endpoint, database change, MCP contract or agent logic.

The latest `QuangDung` (`4d57ef2`) was fetched and inspected first. Its landing,
shared appearance controls, guide content and relevant styles match `main`, so
this change can use `main` as its PR base without carrying unrelated housing
performance or viewing changes. The local `QuangDung` branch remains available.

## Visitor flow

1. Hero retains the existing home image, forest/mint palette and headline. Shorter
   copy explains AI-led coordination and the primary CTA opens the existing `/ai`.
2. A compact service index gives access to all seven services. The old repeated
   card grid is replaced with a larger home/map preview and a complementary
   travel/moving group. Selection, quotes and booking remain distinct.
3. Four user-controlled story steps illustrate natural-language intake, planning,
   dependent/parallel searches, and results with user confirmation. They are
   presentation state, not another orchestration implementation.
4. Visitors can copy an example request and open `/ai`. They must paste, customize
   and send it themselves. The clipboard action never submits a task. Clipboard
   failure leaves readable instructions for manual copying.
5. Roommate discovery shows the kinds of requirements and tradeoffs to inspect.
   It explains consensual connection, not automatic matching. No fabricated
   people, match percentages or public contact details.
6. The landlord section previews existing room availability, listing publication,
   declared costs, contact requests and reviews. It does not advertise automated
   rent collection or tenancy-contract management.
7. Guide previews link to authored articles using the existing supported
   `/guides?article=...` route and `guides/content.ts` as the source. EN UI clearly
   states that the article bodies remain in Vietnamese.

## Boundaries

- Map, profile and dashboard previews are explicitly labelled interface
  illustrations, not live geographic results, listings or people.
- The map uses code-native schematic shapes, not coordinate data. It does not
  imply an administrative boundary, actual road route or available listing.
- No preview calls LLM/provider APIs, performs searches, changes a selection,
  rents a home, connects two people or creates a booking/payment.
- `/ai`, `/login`, `/roommate`, `/landlord`, `/guides`, language and theme controls
  retain their existing behavior. No new auth bypass or route contract.
- VI/EN copy is co-located using the same bilingual pattern as `GuidesPage`.
- Styles are scoped to `.landing-upgrade`; existing workspace CSS is untouched.
- No new raster images, dependencies, timers or autoplay. Reduced motion disables
  presentation animation. Existing hero asset is reused.

## Files and verification

- `Frontend/src/components/LandingPage.tsx`: composition and preview controls.
- `Frontend/src/landing-experience.css`: scoped layouts and responsive styles.
- `Frontend/tests/browser/landing.public.spec.ts`: public-page browser checks.
- `Frontend/playwright.landing.config.ts`: isolated, single-worker test runner.
- `Frontend/tests/browser/app.spec.ts`: existing landing expectations updated for
  intentional CTA/section changes; existing fixtures were not expanded or used
  for this verification.

Run from `Frontend`:

```powershell
npm run build
npx playwright test --config playwright.landing.config.ts
```

The public browser suite does not intercept requests or fabricate API responses.
It checks the real frontend: controls, clipboard, real public guide articles,
unauthenticated entry routes, language/theme persistence, keyboard navigation,
reduced motion, overflow and WCAG A/AA checks at 320/390/768/1024/1440 px in VI/EN
and light/dark. Screenshots are ignored under `data/landing-browser-results`.

The gateway is not running in this local verification environment. Its ordinary
session lookup therefore fails and the public page operates as a guest. This
does not verify authenticated workspaces, the service backends or deployment.
No mock data/tests, paid provider calls or transactions were added.

For a local visual review:

```powershell
cd "E:\Hoc Tap\VIN AI\Build Pharse\P-044\Frontend"
npm run dev
```

Open `http://127.0.0.1:5174/`. The preview controls work without running service
containers. To use actual AI tasks, start the normal gateway/API/services too.
The isolated Playwright preview server stops when its suite completes.

Local results on 2026-10-10: frontend build passed; all 8 public browser tests
passed in 24.4 seconds, including 20 responsive/locale/theme combinations with
no WCAG A/AA violations reported by axe. `git diff --check` passed. These checks
do not establish a usability-study result or production readiness.

## Review before delivery

Review actual copy and visual hierarchy in both languages; especially the
illustration disclaimers and capability boundaries. The PR contains only
landing UI, related tests and this note. Merge only after team review and required
CI checks; no automatic merge or deployment is part of this work.
