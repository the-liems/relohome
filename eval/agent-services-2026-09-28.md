# Independent agent service verification — 2026-09-28

Scope: SPEC-001 and SPEC-003, on local branch `khoa`. No domain MCP integration.

## Evidence

- 21 deterministic contract/policy/HTTP/real-SQLite tests passed.
- 4 opt-in live LLM cases passed with the user's configured OpenAI key and
  `gpt-4o-mini`: service-area intent + actual planning/persistence, ambiguous input,
  housing+moving multi-intent, and out-of-scope creative request.
- Actual Intake and Routing images built; real containers passed HTTP liveness,
  readiness/auth contract, non-root UID and isolated configuration checks.
- After configuring the user's real key, HTTP calls against both Compose
  containers returned 200: Intake classified `moving_catalog`; Routing persisted
  a plan selecting `list_service_areas`. Advancing left it `blocked_integration`
  with no result and zero domain calls, as required by standalone scope.
- Full Python suite: 26 passed, 4 live cases skipped in the ordinary run; those
  same 4 opt-in live cases were verified separately with the real provider.
- Offline export verified 13 tool names/contracts against the current Moving source.
- Ruff checks passed for new implementation and tests.

## Findings during live testing

An earlier Intake prompt asked optional follow-up questions for an already-complete
catalog request and classified an unrelated poem as `information`. Both were
observed failures, not counted as passes. The prompt now defines domain-specific
intent boundaries, empty missing-field lists and blocker-only clarification.
A multi-domain request exposed exact-evidence mismatch; Intake now allows one
bounded re-extraction with the same original input, keeping evidence validation
mandatory. Unicode NFC equivalence is accepted; invented citations still fail.

## Limits

This small live set is smoke evidence, not a statistical accuracy/stability claim.
The running services are independent. No Housing/Maps/Flight/Payment/AhaMove calls,
orders, refunds or booking actions were executed. Scheduler dispatch/observation
code is behind an unconnected internal port; actual provider recovery and
compensation need integration UAT. No mock LLM or provider response was created.

Commands and configuration: [runbook](../docs/runbooks/agent-services.md).
GitHub issue assignment is a separate external action and is not evidence of test completion.
