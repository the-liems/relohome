# Jev hardening verification — 2026-10-14

Issue #155. Branch `fix/155-jev-hardening`, based on `main` `8566aeb`.

## Scope and results

Provider-free regression suite on the modified checkout:

```powershell
.venv/Scripts/python.exe -X utf8 -m pytest tests/test_agents tests/test_checkout tests/test_roommate tests/test_api tests/test_deployment_settings.py tests/test_python_package_boundaries.py apps/browser-gateway/tests -q
```

Result: **700 passed, 8 skipped**, 26.07 seconds, one pre-existing Starlette/AnyIO
deprecation warning. This includes 65 guardrail tests (43 updated original cases and
22 added hardening cases). PostgreSQL/live integrations without configuration remain
skipped; passing unit tests do not prove those integrations worked.

Changed-file Ruff lint and `git diff --check` pass.

Verified cases include:

- Invalid explicit OpenAI/malformed OpenRouter keys rejected before HTTP client creation;
  valid fallback cannot override an invalid dedicated setting; direct client and eval
  CLI use the same credential boundary.
- Names and private address canaries absent from actual mocked HTTP payload, not merely
  from audit output. Narrative evidence removed, nested free strings aliased, structured
  budgets/domains preserved; no reversible mapping emitted.
- Housing/Flight narrative assessments excluded without any Jev request; exclusion
  visible as `privacy_insufficient_evidence`, not a clean/grounded verdict.
- Eligible/submitted/completed denominator, overload/projection/missing-scope/ledger skips,
  duplicate exclusions, fixed-cardinality labels, per-reason timeout/errors, safe arbitrary
  exception handling, periodic skip-only export and final shutdown export.
- Shutdown cancellation before the network coroutine starts, zero-network deterministic
  actions, request context isolation, and existing graph/permission regressions.

## Latency microbenchmark

500 synthetic mock-only plan submissions with a valid mocked decision and completed
background tasks between samples. Timed admission+projection+metrics hook only, excluding
HTTP wait and total application latency:

| Metric | Milliseconds |
| --- | ---: |
| p50 | 0.08455 |
| p95 | 0.10480 |

All 500 completed. This is **not** a before/after user latency comparison, a live Jev
latency measure, a production concurrency load test or an accuracy calibration.
No paid provider calls, real user data, orders or payments were used in this task.

## Environment caveats and corrections

An initial run using the existing root venv had six isolated-interpreter import-path
failures (its editable packages point at the root checkout) and one Windows default-codepage
failure. Those were not hidden or fixed by weakening assertions. A separate ignored
worktree venv installed the local editable packages, reused existing dependency libraries
(not the root editable import hooks), and ran in UTF-8 mode. The final combined suite above
includes those seven tests and passes them. The running root application/venv was not
reinstalled or reconfigured.

Earlier command attempts referenced two nonexistent test filenames; no tests ran in those
attempts. The final command uses the actual test directories/files listed above.

Linux GitHub CI remains required. This report does not assert CI passed. Runtime remains
opt-in shadow-only and default off; structured v2 policy has **not** been semantically
calibrated with live Jev. Historical v1 narrative smoke accuracy does not transfer to it.
