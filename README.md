# ReloHome (P-044) — Multi-Service AI System

ReloHome is an AI system for people planning a relocation. Finding a home, arranging transport for belongings, and booking travel require separate vendors, repeated details, and decisions that affect one another. The intended product turns the customer's goal into one plan they can review, change, and approve step by step.

## Build Phase submission

**Deadline: 23:00 on 18 October 2026 (Vietnam time, UTC+7).** Demo Day is
22 October 2026 alongside VinUni Tech Career Day.
[Submit through Phoenix](https://phoenix.note.transformerlabs.ai/demo-day).

| Submission field | Value |
|---|---|
| Project | **ReloHome — AI-assisted relocation planning** |
| Description | Helps people find housing, explore maps and nearby amenities, request moving quotes, and search flights through a conversational plan with explicit confirmation for supported paid actions. Provider availability and transaction limits are described below. |
| Live MVP | [https://c4-app-044.io.vn/](https://c4-app-044.io.vn/) |
| Demo video, maximum 3 minutes | [Watch demo video](https://drive.google.com/file/d/1XJStE2vlBaC0gtNLLO2UYXvgQ4I_tBng/view?usp=drive_link) |
| Pitch deck | [View pitch deck](https://drive.google.com/file/d/1Y9FUZp_jrP4-YjWiaRkhb99uI7BFshz9/view?usp=drive_link) |
| Project thumbnail, one image | [View project thumbnail](https://drive.google.com/file/d/1MFbn6L1l4fgpaC4AKX9nBtUlNZFFzamB/view?usp=drive_link) |

## Customer journey

1. Tell the AI system where and when you want to move, along with housing, travel, and budget constraints.
2. Compare housing options and select a destination. The selected address can feed the moving quote while travel options are searched where possible.
3. Review the combined plan, source and validity of quotes, estimated costs, dependencies, and missing decisions.
4. Approve each paid action separately, then follow its progress and any recovery or manual follow-up.

The [product brief](docs/product.md) defines the intended customer flow and open decisions. The repository contains an integrated MVP; provider availability and transaction support depend on configuration and the deployed revision.

## Current application

- React browser application in [`apps/web/`](apps/web/README.md), with the authenticated Python gateway in [`apps/browser-gateway/`](apps/browser-gateway/README.md).
- FastAPI agent API and LangGraph workflow in [`apps/agent-api/src/relohome_agent/agents/`](apps/agent-api/src/relohome_agent/agents/README.md), with LLM intake, planning, domain tools, confirmation, and local SQLite persistence.
- Location/Housing/Map and Moving services: [current guide](docs/location/README.md), [map example](examples/map-app/README.md), and [Streamlit lab](docs/location/STREAMLIT_MVP.md).
- Flight search and Payment MCP servers in `apps/flights-mcp/` and `apps/payments-mcp/`. The integrated runtime disables flight booking; moving writes and the standalone ZaloPay sandbox demo require explicit configuration.
- Supported [Streamlit demos](examples/streamlit/README.md) in `examples/streamlit/`: Flight (8501), Payment (8502), and local agent-chat (8501). [Static design references](examples/design-reference/) are retained separately.
- Housing tenant/landlord workspaces and Roommate discovery/chat have continued to evolve through merged PRs; see the [weekly worklog](WORKLOG.md). Standalone Intake and Routing services were retired from GitHub `main` in [PR #234](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/pull/234); their older guides describe historical experiments.

The [testing summary](eval/results/report.md) links current CI and dated browser/provider evidence, including failures and limits. The [frontend service audit](apps/web/SERVICE_AUDIT.md), [integration index](docs/integration/README.md), and [MVP architecture review](docs/review/mvp-architecture.md) are dated records; their findings must be interpreted against the revision they reviewed.

## Run locally

Start with the [development map](DEVELOPMENT.md) for app ownership, installation,
per-app commands, test modes, persistent data and delivery runbooks.

After pulling a Python source relocation, run `npm run setup:python` from the
repository root before launching services or tests. All Python callers use
installed `relohome_*` namespaces. See the
[example/shim migration](docs/integration/python-examples-and-shims.md) for
reinstall, persisted checkpoint compatibility, validation and rollback.

Start with the [local MVP runbook](docs/runbooks/local-mvp.md) for dependencies, provider credentials, database snapshots, service startup, and recovery. Follow the [frontend README](apps/web/README.md) to build and run the browser application at port 8503. The agent runtime requires an LLM API key and a trusted gateway token; copying `.env.example` alone does not configure the services.

The [Moving container runbook](docs/runbooks/moving-containers.md) covers the isolated Moving stack. The root `docker-compose.yml` starts the backend and Flight/Payment MCP containers; Location, Moving, and the frontend have separate setup instructions.

Use the [root tooling runbook](docs/runbooks/root-tooling.md) with Node 24 and Python 3.11. From the repository root, `make install`, `make build`, `make lint`, and `make test` cover the supported workspaces and Python suites. `make test-browser` runs Chrome journeys; live provider checks require explicit opt-in. `make check` never formats files. Existing baseline failures and rollback instructions are recorded in the runbook. Do not commit `.env` or API keys.

## Product scope and delivery

The [confirmed MVP scope](docs/product.md#mvp-scope) includes housing selection, moving services, and travel booking. The current integration implements part of that target; real flight booking and production readiness are not established. The [roadmap](docs/roadmap.md) records the current Build submission and historical Gate 1/G2 deadlines. The [work-in-progress map](docs/work-in-progress.md) is a historical snapshot of branch work; the [weekly worklog](WORKLOG.md) summarizes subsequent merges through 18 October.

## Documentation

- [Documentation index](docs/README.md)
- [Product brief and open decisions](docs/product.md)
- [GitHub issue and PR work in progress](docs/work-in-progress.md)
- [Current architecture and proposed expansion](ARCHITECTURE.md)
- [Working conventions](docs/project-organization.md)
- [Coolify deployment: setup, staging, production and rollback](deploy/README.md)
- [Infrastructure and scaling](docs/architecture/infrastructure.md)
- [Coolify scaling and migration options](docs/architecture/migration-options.md)
- [City dataset catalog](Maps%20VN/Cities/README.md) and [map data workflow](docs/runbooks/map-data.md)
- [Development journal](JOURNAL.md) and [worklog](WORKLOG.md)
- [Evaluation report](eval/results/report.md)
- [Build submission checklist and demo materials](presentation/README.md)
- [AI20K technical guide](docs/guide/chapter-01.md)

## Team

| Member | Student ID |
|---|---|
| Đặng Đỉnh Đoàn | 2A202602927 |
| Ngô Anh Khoa | 2A202602965 |
| Mai Quang Dũng | 2A202602966 |
| Nguyễn Dũng | 2A202602812 |

## AI usage logging

The repository includes hooks for AI usage logging. Each contributor can run `npm run dev:init` to create `.env.local`, set their own `AI_LOG_API_KEY` from the [Phoenix dashboard](https://phoenix.note.transformerlabs.ai/api-keys), and run `bash scripts/setup_hooks.sh` (or `scripts/setup_hooks.ps1` in PowerShell). See [SECURITY.md](SECURITY.md) for credential handling.

| AI tool | Hook configuration |
|---|---|
| Claude Code | `.claude/settings.json` |
| Cursor | `.cursor/hooks.json` |
| OpenAI Codex CLI | `.codex/hooks.json` |
| Gemini CLI | `.gemini/settings.json` |
| GitHub Copilot | `.github/hooks/hooks.json` |
| Antigravity IDE | `.agents/hooks.json` |

For ChatGPT and other web tools, record usage manually:

```bash
bash scripts/_pyrun.sh scripts/log_manual.py --tool chatgpt --prompt "What you asked"
```

Usage records are stored in `.ai-log/session.jsonl`; the pre-push hook submits them to the grading server.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. The current [.github/CODEOWNERS](.github/CODEOWNERS) assigns the default `*` rule and `/docs/` to `@AI20K-Build-Phase/book-maintainers`, including documentation PRs. Changes to `docs/guide/` also affect the published Technical Book and require its maintainers' review.

## License

[MIT](LICENSE).

Python package installation, runtime paths, wheel validation and compatibility removal:
[Python packaging guide](docs/integration/python-packaging.md).
