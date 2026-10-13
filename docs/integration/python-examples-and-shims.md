# Python examples and source-shim retirement (#115)

> Historical layout/command evidence (M23); use the [current development map](../../DEVELOPMENT.md) for this branch.


Base: `b714b7b` (main, merged #139 / #114), worktree branch
`codex/issue-115-python-examples`. This is the Python examples/design-reference
slice of #115 under epic #108. Location/map/database/script relocation under
`Maps VN/LifeFlow/` is a separate slice and is unchanged, including the exact
`"Maps VN/LifeFlow/demo/test_demo.py"` entry in `test:python`.
No data migration, provider/live call, publication or deployment is performed.

## Examples, installation and launchers

| Project | Distribution / import | Existing root entrypoint and port |
| --- | --- | --- |
| `examples/streamlit` | `relohome-demos` / `relohome_demos` | `make ui` / `npm run dev:flight-demo`: Flight, 8501 |
| same project | same distribution | `make ui-payment` / `npm run dev:payment-demo`: Payment, 8502 |
| same project | same distribution | `make ui-agent-chat` / `npm run dev:agent-chat`: chat, 8501 |
| `examples/design-reference` | Static HTML/JS/screenshot references | No runtime entrypoint or distribution |

All nine former demo files move to `examples/streamlit/src/relohome_demos/`.
The new pyproject declares shared `relohome-flight` / `relohome-payment` and its
third-party HTTP/MCP/Streamlit/QR dependencies; it imports no application package.
There is no contracts dependency because these demos do not import contracts.
The clients communicate with application APIs/MCP servers over HTTP. Both old
checkout `sys.path` injections are removed. ReloHome is used in page/title display
text; no protocol, service, environment or stored identifier is renamed.

`requirements-dev.txt` installs the project editable alongside the other thirteen
projects. After pulling, **reinstall** root requirements in the existing venv.
Root npm launchers still load `.env.local`, set the existing runtime root, and
run from the repository cwd. Flight and chat retain Streamlit's default 8501
and run separately; Payment retains explicit 8502. Direct wheel users can obtain
script paths through `importlib.resources.files('relohome_demos')`.
See the [demo guide](../../examples/streamlit/README.md) for exact settings.

The services still own `./data/flights.db`, `./data/payments.db`, and integration
`data/integration-payments.db`. Agent runtime databases/checkpoints/keys remain
under the configured existing root. Housing media remains
`Frontend/data/housing-media` locally, `/app/data/housing-media` in containers.
No runtime data was moved or deleted. `Frontend/data/` is explicitly ignored;
there are no remaining Python source files under `Frontend/`.

All eight original design-reference files are byte-identical to base, including
historical SIU/THE LIEMS names and generated `support.js`. Current root docs link
to the new location; dated audits and handoffs keep their original evidence.

## Complete source accounting and caller migration

[Source accounting](python-examples-and-shims/source-accounting.tsv) accounts for
**every one of the 105 tracked base files under `src/` and `Frontend/`**:

- 9 demo files moved into the installable example;
- 89 other `src/` forwarders/namespace files deleted;
- 7 `Frontend/` forwarders/namespace files deleted.

The 96 deleted source files include the on-disk checkpoint forwarder. Its
persisted alias survives in the canonical model/serializer code described below.
Only obsolete Python bytecode and empty source directories were cleaned up.
Ignored media and any other runtime files are outside the tracked accounting
and must be retained. No tracked `Frontend/data` files existed at this base.

[Caller migrations](python-examples-and-shims/caller-migrations.tsv) lists the
72 Python files that consumed temporary shared/demo imports and their canonical
imports. It includes Flight/Payment engine/provider/schema tests, standalone
common/contracts/LLM tests, Roommate domain/API/gateway fixture tests, agent form
and MCP integration tests, and the demo modules themselves. Root integration
fixtures/suites remain at root because they exercise multiple applications;
new demo-only configuration/first-render tests live beside `examples/streamlit`.
No existing behavioral assertion was relaxed to accommodate a missing shim.

Other caller/configuration surfaces:

| Surface | Migration / audited disposition |
| --- | --- |
| `package.json`, Makefile | Three demo paths relocated; existing Make targets still delegate to root npm with original ports/env/cwd |
| `pytest.ini`, `test:python` | Discover demo-local tests; retained Location demo test argument unchanged |
| Gateway relocation tests | Replace 6 old module-identity and 6 stale-finder tests with single-source ownership and isolated canonical-origin checks |
| Agent relocation tests | Replace 5 stale-finder tests with isolated canonical editable-origin checks |
| Boundary tests / compatibility register | Discover all 14 projects, forbid app dependencies in examples, assert only persisted alias and no legacy source shells |
| Ruff / format / mypy scopes | Replace deleted root `src/` with `examples/streamlit/`; established other application/test/package scopes preserved |
| `.github/workflows/mvp.yml` | Canonical lint/compile roots replace `src`; other workflow filters already point at relocated apps/packages |
| CI image selector/catalog | Remove retired `src/` / `Frontend/` build dependencies; examples/static references do not trigger app image builds |
| Dockerfiles / Compose | All six Python CMDs/COPY instructions and Compose already use installed canonical apps at this base; no remaining shim launcher found |
| `.dockerignore` | Exclude examples/design references and legacy local `Frontend` state from runtime build contexts; app-specific allowlists already exclude both roots |
| Image/install/smoke scripts | Add demo installed-import selector and all six Python services to workspace image checks; MCP smoke also runs installed imports from `/tmp` with `--network none`; standalone agent smoke is unchanged (its probe needs the container address) |
| `.github/CODEOWNERS` | New example roots explicitly retain the existing default owner |
| README, ARCHITECTURE, CONTRIBUTING, current runbooks and tutorial imports | Explain installable examples, canonical imports, preserved state and rollback; links point at current source |

The unfiltered main CI job already runs root `lint:python` and `test:python`, so
new demo discovery applies automatically. Standalone workflow filters and the
M21 `lifeflow-typescript` job key remain intact. ADR-025 is still **Proposed** at
this base, so the #115 check does not change ADR-001/ADR-013 acceptance/history.
Dated integration notes, eval reports and pinned inventories are unchanged (M23).
M20/M21/M24 and all infrastructure identifiers remain intact; no change was made
to the parallel Location/map slice.

## Single retained alias and ownership

`src.agents.models` → `relohome_agent.agents.models` is the **only retained alias**
in `packages/python/compatibility.json`. It is a persisted LangGraph type
identifier, not an operational source import. Canonical model import registers
the legacy key in `sys.modules`; `checkpoint_serde()` accepts explicitly allowed
classes under both identifiers. There is no on-disk `src` namespace dependency.
Newly written model payloads retain the legacy type ID so previous rollback
images can read them. The frozen pre-ReloHome SQLite regression resumes the
checkpoint, checks model identity and narrow allowlist, accepts canonical reads,
and checks byte-identical legacy writes; it passes against the installed wheels
outside the checkout.

**Owner:** agent/checkpoint maintainers (inherited #114; audited under #116).
**Future removal gate:** an explicit persisted-format transition, migration or
expiry of old checkpoints/backups, and retirement of older rollback images.
Ordinary source cleanup, elapsed time or successful package builds do not satisfy
that gate. No additional module alias or speculative facade is retained.

Unknown private/copied-checkout consumers cannot be ruled out by repository
search or the earlier public-registry assessment. **Owned #116 follow-up:**
packaging/application maintainers must inventory downstream launch scripts and
private/copied deployments, record any consumer and migration window, and verify
open #76 gateway helpers and #107 telemetry changes rebase to canonical modules.
These are explicit
follow-ups, not an undocumented reason to preserve all forwarding modules.

## Removal-reference evidence

Combined-tree refresh: [final #115 audit](monorepo-final-audit.md#reproduction-and-counts)
reconciles this slice with #141, classifies canonical app-local paths and retains
only the persisted alias. Counts below describe this slice's original tree.

The requested command was run verbatim:

```sh
git grep -nE "\bsrc\.(ui|models|roommate|agents|agent_services|mcp_servers|main)\b|Frontend\.|from src\b|import src\b|src/ui"
```

On this macOS Git regex engine `\b` does not act as the expected word boundary.
It returns **80 tracked hits: 64 historical, 16 false positives**. Therefore the
check was supplemented with the portable equivalent:

```sh
git grep -nE '(^|[^[:alnum:]_])src\.(ui|models|roommate|agents|agent_services|mcp_servers|main)([^[:alnum:]_]|$)|Frontend\.|from src([^[:alnum:]_]|$)|import src([^[:alnum:]_]|$)|src/ui'
```

That returns **235 tracked hits: 12 persisted-alias references, 207 historical,
16 false positives**. [Every hit is classified with its file/line and reason](python-examples-and-shims/remaining-references.tsv).
False positives are generic frontend prose or app-local TypeScript CSS paths,
not Python source callers; they are identified separately rather than mislabeled
as historical. The historical bucket includes previous-slice source accounting,
ADR rationale, dated plans and pinned baseline commands. Current launchers,
Python imports, tests, Docker/Compose, workflows and runbooks have **zero
operational legacy callers and zero unclassified bugs**. A supplemental `rg`
scan of new/current Python source also finds only checkpoint contract references.
The new untracked migration artifacts describe retired paths as evidence; Git's
tracked-file search does not include them until review/staging.

## Observed validation

Python 3.11.16; Node 26.0.0/npm 11.12.1 available in this session (the supported
repo contract remains Node 24). Every Python command used this worktree's `.venv`:
`env -u VIRTUAL_ENV ./.venv/bin/python ...`, or root npm with
`PYTHON=$PWD/.venv/bin/python`. No other checkout/venv was used.

| Command / check | Exact observed result |
| --- | --- |
| `python -m pip install -r requirements-dev.txt` | Failed: PyPI DNS access prevents isolated setuptools download |
| `python -m pip install --no-index --no-build-isolation -r requirements-dev.txt` | Passed for all 14 editable projects using installed setuptools 79.0.1; repeated after wheel checks; no editable mapping points to a deleted source path |
| Unchanged base `npm run test:python` | **5 failed, 927 passed, 103 skipped, 136 subtests passed** |
| Head `npm run test:python` | **5 failed, 932 passed, 103 skipped, 136 subtests passed**; 5 additional demo tests; no new failure IDs |
| Head full `python -m pytest` | **5 failed, 928 passed, 103 skipped**; the portable command additionally collects 4 retained Location demo tests |
| `npm run lint` | Passed (Python and unchanged TS workspace lint) |
| `npm run format:check` | Failed: **37 files would be reformatted, 270 already formatted**; every failing file also fails at unchanged base (120 base files unformatted, including deleted shims); no new formatting failure |
| `npm run test:contracts` | **42 passed** |
| `npm run deployment:check` | **55 passed, 84 subtests passed** |
| Focused boundary/app/gateway/checkpoint/demo pytest | **36 passed** |
| `python -m pytest tests/test_ci_container_smoke.py -q` | **5 passed, 7 subtests passed**, including failure cleanup and isolated MCP import probes |
| `python -m pip wheel --no-deps --no-index --no-build-isolation --wheel-dir /tmp/115-wheels <all 14 projects>` | Passed; [all wheel Python/JSON manifests match their source](python-examples-and-shims/wheel-module-counts.json) |
| Install `/tmp/115-wheels/*.whl` into this same venv with `--no-index --no-deps --force-reinstall` | Passed; no editable mapping present during wheel checks |
| `scripts/check-python-install.py` under `python -I` from `/tmp`: backend, web, flights-mcp, payments-mcp, intake, orchestrator, demos | All **7 passed** against real wheels; module origins in site-packages; packaged catalog/fixture JSON available |
| Historical checkpoint test / stdin helper under isolated wheel Python from `/tmp` | Passed, including exact legacy writer bytes and canonical-reader allowlist |
| Wheel `pytest examples/streamlit/tests/test_demos.py tests/test_checkpoint_compatibility.py -q` | **6 passed** (three demo first renders, two client config tests, historical checkpoint) |
| `python scripts/smoke-streamlit-demos.py` (editable and wheels) | Codex sandbox: blocked by socket-bind permission. Re-run by Claude (below) |
| Docker image builds and smoke scripts | Codex sandbox: blocked by Docker socket permission. Re-run by Claude (below) |
| `git diff --check`; static-reference comparison; parallel-slice diff | Passed; all 8 static files unchanged; no diff under `Maps VN/LifeFlow/` |

### Re-run with socket and Docker access (Claude, same branch, macOS arm64, Docker linux/aarch64)

| Command / check | Result |
| --- | --- |
| `npm run test:python` | **937 passed, 103 skipped, 136 subtests passed, 0 failed** (#139 head: 932 passed; +5 demo tests) |
| `npm run lint`; `npm run deployment:check` | Passed; **55 passed, 84 subtests passed** |
| `python scripts/smoke-streamlit-demos.py` | **PASS** flight_demo, payment_demo, agent_chat: installed script, headless startup and health |
| `python scripts/check-workspace-images.py backend web flights-mcp payments-mcp intake orchestrator` | All six built; **PASS** installed distribution/entrypoint/resource checks from `/tmp` (`--network none`, non-root); default-CMD HTTP startup passed for all six; web gateway health, index, built JS and SPA fallback passed |
| `make mcp-build` + `scripts/smoke-mcp-containers.sh` | Both MCP containers `/health` ok (mock providers), installed import PASS under the non-root USER |
| `Dockerfile.agents` intake/orchestrator + `scripts/smoke-agent-containers.py` | **PASS** both: installed import, HTTP liveness/readiness, isolated configuration |
| `pytest tests/test_ci_container_smoke.py` | **5 passed, 7 subtests passed** |

The five pytest failures recorded by the Codex run were socket-permission
failures in its sandbox; they pass with socket access.

The supplied #139 head result is **932 passed / 103 skipped**. This session's
unchanged base instead has 927 passes and five socket permission failures. Head
adds five passing cases without new failures: there are 937 passing-or-blocked
cases, five more than #139. [Exact base](python-examples-and-shims/pytest-base-failures.txt)
and [head failure IDs](python-examples-and-shims/pytest-head-failures.txt) match.
No skip, timeout, fixture assertion or provider opt-in was changed to hide them.
Existing format drift is a separate owned #116 tooling follow-up.

Wheel check reproduction (install wheels into the existing worktree venv, then
restore editable requirements afterwards):

```sh
# From this worktree root, using only its existing .venv.
env -u VIRTUAL_ENV ./.venv/bin/python -m pip wheel --no-index --no-deps \
  --no-build-isolation --wheel-dir /tmp/115-wheels \
  ./packages/python/{agent-services,contracts,flight,mcp-http,payment,privacy,roommate} \
  ./apps/{agent-api,browser-gateway,flights-mcp,payments-mcp,intake-api,orchestrator-api} \
  ./examples/streamlit
env -u VIRTUAL_ENV ./.venv/bin/python -m pip install --no-index --no-deps \
  --force-reinstall /tmp/115-wheels/*.whl
task_python="$PWD/.venv/bin/python"
task_root="$PWD"
task_runtime=$(mktemp -d /tmp/relohome-wheel-check.XXXXXX)
mkdir -p "$task_runtime/config/agent-services"
cp config/agent-services/registry.json "$task_runtime/config/agent-services/registry.json"
cd /tmp
for service in backend web flights-mcp payments-mcp intake orchestrator demos; do
  RELOHOME_RUNTIME_ROOT="$task_runtime" env -u VIRTUAL_ENV "$task_python" -I - "$service" \
    < "$task_root/scripts/check-python-install.py" || break
done
RELOHOME_RUNTIME_ROOT="$task_runtime" env -u VIRTUAL_ENV "$task_python" -I - \
  "$task_runtime" "$task_root/tests/fixtures/pre-relohome-checkpoint.json" \
  < "$task_root/tests/checkpoint_compatibility_smoke.py"
cd "$task_root"
env -u VIRTUAL_ENV "$task_python" -m pip install --no-index --no-build-isolation \
  -r requirements-dev.txt
```

**Remaining gates:** CI's multi-arch/publish jobs run on the PR; #116 owns the
external-consumer census and staging existing-data/digest verification.

## Rollback

Revert this slice, reinstall reverted requirements in the local venv, and rebuild
or select prior published image digests through the existing release process.
Do not reset or migrate databases, keys, checkpoints, media, volumes or registry
configuration. Existing checkpoints retain their old identifiers for older
rollback readers. Restore source and launch paths together; no data restore or
provider operation is required. No deployment was performed.
