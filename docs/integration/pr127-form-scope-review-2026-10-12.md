# PR #127: independent review and guided-form scope fix

Review baseline: `QuangDung` at `93fb6ba8fd422d892482adf64914662bcf5ce6a8`, targeting `main`.
Tracking issue: [#132](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/132).

## Confirmed finding

`requestDefaults` previously selected the first progress item for a domain and
overlaid it on the current plan. Progress retains older goals, so a new HCM
housing form could inherit an old Hanoi budget of 5 million and air conditioning.
The API serializes domains under `intake.intent.domains`; `intake.domains` is
a Python property, not a serialized field. Navigation also discarded the clicked
task ID when opening a form, selecting the wrong route among same-domain tasks.

## Fix

- Read the actual serialized intake shape, with compatibility for older snapshots.
- Use an explicit task ID, a unique current plan task/target, or a pending task;
  never choose the first historical progress item for a fresh form.
- Current plan inputs replace stale progress inputs, including removed criteria.
- Keep explicitly opened historical task inputs separate from current intake values.
- Do not silently substitute comparison tasks or invalid IDs with another search.
- Bind service-navigation and flight-edit forms to their task IDs. Reset unrelated
  prefills. Remount when the form's service/task changes, but not when submission
  creates a thread: HTTP 200 Agent errors must preserve the user's draft.

No backend, API payload, agent orchestration, environment, or payment changes.

## Verification

- Final `npm run build:web`: TypeScript and Vite passed.
- Final `npm run test:contracts`: 41 passed, including 6 new scope regressions.
- Final relevant browser suites: 78 passed on desktop/mobile, including 4 new
  browser executions. Suites: `service-input`, `service-followup`, `viewing-bulk`,
  `viewing-suggestions`, and `viewing-closed-request`.
- Also checked error/draft retention, focus/keyboard, VI/EN, light/dark, exact
  serial viewing payloads, partial failures and lost-response reconciliation.
- Browser tests used mocked API fixtures, not live provider bookings/payments.
  On Windows, Vite was managed separately for the final browser run to avoid
  Playwright web-server teardown hanging; no production services were stopped.
- Reviewed scheduling and suggestions independently of the handoff. Batch viewing
  remains non-atomic and intentionally stops on uncertain results; no automatic
  retry or rollback was added.
- Data ZIP LFS pointer matches the SHA256 sidecar and its download is available.
  The 806 MB archive was not downloaded/restored during this frontend review.

CI must pass on the updated PR head before merging. Local checks do not establish
that staging has deployed or that live LLM/provider flows are healthy.
