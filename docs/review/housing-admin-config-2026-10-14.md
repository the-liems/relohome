# Housing/Admin configuration review — 2026-10-14 (Asia/Saigon)

Reviewed against main `8566aebf89f4ceb6a5eb10362f6d92054153e3ae`, with
QuangDung `1038a2ef4cefe896af3a4a1a631861b400c0f2ea` read separately. Changes
are isolated in `fix/housing-admin-current-config`; the original checkout's
uncommitted presentation/crawler/preprocess work and running services are retained.

## Recent PRs and impact on this work

| PR | Observed status | Housing/Admin impact |
| --- | --- | --- |
| #135 | Merged | Original Housing moderation, separate Admin login, cloud/operator tools. |
| #137 | Merged | Tests clean inherited shell configuration; fixtures must set their runtime root explicitly. |
| #138 | Merged | Web moved to `apps/web`, installed gateway to `apps/browser-gateway/src/relohome_gateway`. Old `Frontend.*` imports are gone. |
| #139, #141, #142, #144 | Merged | Canonical Python/TS app/package ownership, retired source shims, SQL in `deploy/database/migrations`, updated launch/build commands. Existing ignored data paths remain. |
| #145 | Merged | Adds backend Jev configuration in Coolify; default guardrail mode is `off`. No Housing moderation or account schema replacement. |
| #146 | Open; CI successful for inspected head | QuangDung changes Admin/Landlord presentation and shared design tokens. Does not replace backend authorization/account provisioning. No file overlap with this patch. |
| #154 | Open; CI successful | Chat presentation; integrated into the inspected QuangDung head. No file overlap with this patch. |
| #156 | Open; CI successful | Jev credential/privacy/metrics hardening. No file overlap with this patch. |
| #147 | Open | Monorepo acceptance documentation, separate from this operator fix. |

This review covers integration/configuration relevant to Housing/Admin, not an
independent security or exhaustive functional review of every open PR. PR status
is a snapshot; merge checks must use the final heads.

Main CI [38436404539](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/38436404539)
and [Deploy staging 38450370387](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/actions/runs/38450370387)
completed successfully. Deployment workflow success confirms release submission;
it does not establish Admin credentials or completion of authenticated staging tests.

## Findings and minimal fixes

1. Issue #140 still invoked `Frontend.admin_provision` and linked deleted Python
   source. Replace with `python -m relohome_gateway.admin_provision` and the
   canonical source URL; retain the operator's unchecked handoff checklist.
2. Admin provisioning and web backup used their own `/app/data` defaults and
   resolved relative environment/CLI paths from terminal cwd. The gateway uses
   `RELOHOME_RUNTIME_ROOT`. A valid existing account could be reported missing;
   new provisioning could target a different database and backup could select
   the wrong media/key. Both CLIs now use the gateway's runtime path helpers.
   Missing/relative runtime root fails before provisioning prompts or writes.
   Explicit relative database/media/key overrides use that same root.
3. Runbook and CLI advised restarting Platform after environment edits. Document
   Save + redeploy/recreate, retaining existing moderator IDs and release images.
4. Cloud runbook described an unmerged feature branch and `/health` on all
   services. Update canonical layout and use Location `/healthz` + `/readyz`.

The Coolify contract stays intact: web image sets `RELOHOME_RUNTIME_ROOT=/app`;
Compose sets `SIU_WEB_DB=/app/data/siu-web.sqlite3`,
`SIU_HOUSING_MEDIA_DIR=/app/data/housing-media` and persistent `web-data:/app/data`.
Moderator IDs and Vietmap key belong on Platform. Local media keeps its existing
`Frontend/data/housing-media` default; this legacy state path is not an import.
No SQL changes, data imports, account resets, new dependencies, UI changes or
deployment actions are part of this patch. Roommate storage settings and Jev
configuration added by other PRs remain as on main.

## Validation

Separate Python 3.11 virtualenv with editable packages from this worktree; no
live provider/LLM calls and no writes to existing local/staging databases.

```bash
python -m pytest apps/browser-gateway/tests tests/test_coolify_deployment.py -q
```

Result: **105 passed, 1 skipped, 62 subtests passed**. The skip is the existing
NTFS ACL test on Linux. The newly resolved unconstrained test dependencies emit
one FastAPI/Starlette TestClient deprecation warning; tests passed.

The 11 new cases cover account/session/active-run preservation; CLI creation
without printing passwords; matching database/media/key selection under default,
relative environment, relative CLI and Coolify-style absolute configuration;
and failure before prompting/writing without a runtime root. Existing Admin
session/permission, gallery/public visibility, relocated installed-import and
Coolify deployment regression tests also passed.

Replaying the new existing-account test with main's operator implementation
(`relative_environment`) fails with `This web database does not exist`, proving
the path regression. The corrected implementation passes it. Ruff lint/format
for all changed Python files and `git diff --check` pass.

Staging account creation, moderator environment changes, password handoff and
authenticated smoke testing remain assigned to the Coolify operator in
[issue #140](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/140).
