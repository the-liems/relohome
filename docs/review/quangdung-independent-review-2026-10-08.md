# Independent review — QuangDung, 08/10/2026

## Decision and scope

**Do not integrate into the active demo workspace yet.** The branch contains useful
work, but the current Python CI lint command fails and independently checked
selection/price freshness behavior has defects.

- Reviewed head: `374d38cce65787d279680abb3775841a8a54c62c`.
- Compared with the last integrated QuangDung head: `07f23b6`.
- Change size: 248 files, 34,771 insertions and 1,884 deletions, including previous
  Moving PR work; this is not exclusively new teammate-written code.
- Fetched the branch and checked it out separately at
  `data/worktrees/review-quangdung-20261008`, detached at the reviewed commit.
- Active workspace remains on `review/quangdung-post-mvp@62f83b7`. Existing dirty
  files, private configuration, database and running services were not replaced.
- Review covered changed agent/state integration, Roommate models, eligibility,
  scoring, discovery, identity boundary, consent, contact lifecycle, media and
  storage; relevant frontend state/requests; geocode export/apply guards.
  This is not a claim of exhaustive runtime coverage of all 248 changed files.

The findings below came from reading implementation and directly checking edge
inputs, not from accepting the handoff's existing defect list as authoritative.

## Confirmed findings

### R1 — P1: the CI lint command fails on newly changed code

`ruff check src/ tests/ --output-format concise` reports **25 errors** at this
head: one in `src/agents/progress.py:75`, and 24 in the newly added
`tests/test_housing_geocode.py`. They include UP017, I001, E702, E731 and F401.

The same `ruff check src/ tests/` command appears in both this checkout's workflow
and the fetched `origin/main` workflow. Therefore a successful frontend build or
Roommate test subset is not evidence that this change passes the Python lint gate.
This is a local reproduction, not a claim about the latest GitHub run result.

A broader targeted lint command also reports **35 errors in the three new
housing-geocode scripts**, plus the same progress.py error. Those script errors
are outside the currently checked `src/ tests/` CI paths, but should be cleaned
before describing the tooling as lint-clean. Do not disable rules to hide them.

### R2 — P2: invalidated selections still contribute current-looking prices

Locations: `src/agents/progress.py:212-228` and `src/api/routes.py:323-338`.

`goal_selections` now persists choices across goals. However, `plan_progress`
adds their prices when the quote is not expired, without requiring task status
DONE. `_selections` also exports remembered choices without checking task status
or freshness.

Direct function check: a remembered Moving choice with `task_status=STALE` and
a still-unexpired 300,000 VND quote produces:

```text
progress state = waiting
one_time_vnd = 300000
selection exported to UI = true
```

After an input/dependency change, a quote can be invalid even before its TTL
expires. The old option may remain visible as history, but must not silently
contribute to a current total or be exported as a currently valid choice.

Suggested correction: separate historical choice metadata from usable selection;
require a valid DONE result and applicable freshness checks for active price
totals/selection exports. Preserve committed receipt semantics separately.

This reproduction concerns display/state projection. It does **not** establish
that approval or booking guards can be bypassed.

### R3 — P2: expiration handling ignores remembered Flight choices

Location: `src/agents/progress.py:63-78`.

`_quote_expired` immediately returns false for every domain except RELOCATION.
The newly persisted Flight selection can therefore remain confirmed and retain
its old fare after expiry, even during a later unrelated conversation goal.

Direct function check with an already-expired Flight offer and remembered choice:

```text
progress state = confirmed
one_time_vnd = 300000
selection exported to UI = true
```

Suggested correction: evaluate the selected offer's expiry, with result-level
expiry as an appropriate fallback; handle Flight and Moving consistently. Treat
missing/malformed expiry conservatively where required by the domain. A historical
choice is not a current provider quote. Do not treat a booked receipt as a quote.

### R4 — P2: accepted second-level quiet hours can become an entire day

Locations: `src/roommate/models.py:86-99` and
`src/roommate/normalization.py:27-38`.

The model accepts different times within the same minute, such as
`22:00:00 -> 22:00:30`. The normalizer drops seconds; its start == end branch
then constructs all 1,440 minutes instead of a 30-second interval.

Direct check:

```text
quiet_overlap(22:00:00..22:00:30, 00:00..06:00) = 0.25
```

These disjoint intervals should not overlap. This affects compatibility ranking
and can affect hard quiet-hour matching. Reject seconds/sub-minute inputs if the
contract is minute-resolution, or compute intervals at the resolution accepted
by the schema. Ordinary browser time inputs do not eliminate the API edge case.

## Positive design observations

- Moving quote latency PR #53 is already included. GitHub reports #53 merged
  into its base on 07/10; this does not mean the larger QuangDung PR is in main.
- Frontend has substantial workspace, accessibility, theme/language and
  responsive changes. Its production build succeeded independently here.
- Roommate is a real isolated local service, not just a public profile listing:
  strict models, explicit hard/soft preferences, two-way hard eligibility,
  unknown-aware scoring, contact encryption, version-bound consent, transactional
  writes, block/revoke paths and reference-only agent history are present.
- Roommate discovery/scoring uses code without per-candidate LLM calls. Intake
  and Planner interpret the natural-language request. This is a deliberate
  separation of interpretation from eligibility/authorization, not inherently
  a missing LLM feature.
- Gateway identity comes from the existing session, not a browser-supplied actor.
  Private APIs/media have dedicated access boundaries and no-store policies.
  This observation is not a completed security audit or proof of all race cases.
- Geocode tooling includes bounded matching/displacement rules, preservation of
  verified records, checksum checks, target locking, backup/journal and commit
  reconciliation. None of those scripts were run against the live DB in this review.

## Verification actually performed

| Check | Independent result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` in isolated Frontend | Passed |
| `npm run build` (TypeScript + Vite) | Passed |
| Six pure Roommate model/normalization/connection/factor/ranking/eligibility test files | 97 passed |
| Direct selection/freshness function checks | Reproduced R2 and R3 |
| Direct quiet-hour interval check | Reproduced R4 |
| `ruff check src/ tests/ --output-format concise` | Failed: 25 errors |
| Targeted lint including geocode scripts | Failed: 36 errors, including the overlapping progress.py error |
| `git diff --check 07f23b6 origin/QuangDung` | Passed |

The initial 84-test subset was repeated with eligibility added; **97 is the
unique final subset count**, not 181 tests. Edge checks used model/function inputs
in memory, not fake provider responses or seeded production profiles. No new
mock test files were created. No paid LLM calls, provider transactions, DB
restore/migration/geocoding apply, or server replacement was performed.

Full pytest, browser end-to-end, real multi-turn LLM/provider flows, deployment,
multi-worker concurrency and all Roommate release gates were not independently
executed in this review. The handoff's reported 29 baseline pytest failures are
not independently revalidated here, nor assumed to be the exact baseline of the
now-updated main branch.

## Integration recommendation

1. Address R1-R3 before merging the branch into the main demo integration; address
   R4 with a schema/normalization boundary regression check before Roommate release.
2. Keep the useful features; there is no evidence here that warrants discarding
   the whole Roommate service or reverting the Moving latency work.
3. Reconcile overlapping local changes in a separate integration worktree. Do not
   force-pull, reset, or overwrite the active workspace's private/uncommitted work.
4. Validate the prospective merge against the latest main, run the applicable
   tests and CI, then obtain team review. A branch-local baseline is not a waiver
   for failures against the target branch.
5. Keep Roommate behind its feature flag until the explicitly outstanding release
   gates are met; do not infer readiness from build success or mock browser tests.

GitHub state read during this review: [PR #42](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/42)
is open from QuangDung to main at the reviewed head;
[issue #65](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/65) remains open.
No issue comments, PR reviews, merges, pushes or application fixes were submitted
as part of this independent review.

## Follow-up implementation (2026-10-08)

At the user's subsequent request, QuangDung `374d38c` was integrated into the
active workspace on `fix/quangdung-review-20261008`, preserving local changes in
a checkpoint commit first. R1–R4 are now addressed locally; the original findings
above describe the reviewed baseline, not the current working tree.

Shared selection/freshness checks now guard progress totals, UI selections,
remembered homes and selection actions. Roommate quiet hours enforce minute
precision. Lint and both frontend/TypeScript workspace builds pass. The final
targeted suites have 214 unique passing tests; real Housing → UI selection →
Flight multi-turn and Map → Moving staging quote/requote flows also passed.
This is not a full CI/release certification and Roommate remains disabled locally.

See [implementation and verification handoff](../integration/quangdung-review-fixes-2026-10-08.md)
for exact scope, measurements, exclusions and remaining release gates.
