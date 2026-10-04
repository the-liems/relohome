# THE LIEMS (P-044) — Multi-Service AI System

THE LIEMS is developing an AI system for people planning a relocation. Finding a home, arranging transport for belongings, and booking travel require separate vendors, repeated details, and decisions that affect one another. The intended product turns the customer's goal into one plan they can review, change, and approve step by step.

## Customer journey

1. Tell the AI system where and when you want to move, along with housing, travel, and budget constraints.
2. Compare housing options and select a destination. The selected address can feed the moving quote while travel options are searched where possible.
3. Review the combined plan, source and validity of quotes, estimated costs, dependencies, and missing decisions.
4. Approve each paid action separately, then follow its progress and any recovery or manual follow-up.

The [product brief](docs/product.md) defines the intended customer flow and open decisions. This branch contains the local integration MVP; provider availability and transaction support depend on configuration.

## Current application

- React browser application and authenticated Python gateway in [`Frontend/`](Frontend/README.md).
- FastAPI agent API and LangGraph workflow in [`src/agents/`](src/agents/README.md), with LLM intake, planning, domain tools, confirmation, and local SQLite persistence.
- Location/Housing/Map and Moving services in [`Maps VN/LifeFlow/`](Maps%20VN/LifeFlow/README.md).
- Flight search and Payment MCP servers in `src/mcp_servers/`. The integrated runtime disables flight booking; moving writes and the standalone ZaloPay sandbox demo require explicit configuration.
- Separate Intake and Routing services in `src/agent_services/`; their execution gateway is disconnected by default.

The [frontend service audit](Frontend/SERVICE_AUDIT.md), [integration index](docs/integration/README.md), and [MVP architecture review](docs/review/mvp-architecture.md) describe coverage and limitations. Existing test failures and review findings remain open.

## Run locally

Start with the [local MVP runbook](docs/runbooks/local-mvp.md) for dependencies, provider credentials, database snapshots, service startup, and recovery. Follow the [frontend README](Frontend/README.md) to build and run the browser application at port 8503. The agent runtime requires an LLM API key and a trusted gateway token; copying `.env.example` alone does not configure the services.

The [Moving container runbook](docs/runbooks/moving-containers.md) covers the isolated Moving stack. The root `docker-compose.yml` starts the backend and Flight/Payment MCP containers; Location, Moving, and the frontend have separate setup instructions.

Use `ruff check src/ tests/` and `pytest tests/ -v` for the Python checks. Build and test the TypeScript services with `npm ci`, `npm run build`, and `npm run test:ci` from `Maps VN/LifeFlow/`. Live tests require their documented opt-in settings and provider configuration. Do not commit `.env` or API keys.

## Product scope and delivery

The [confirmed MVP scope](docs/product.md#mvp-scope) includes housing selection, moving services, and travel booking. The current integration implements part of that target; real flight booking and production readiness are not established. The [roadmap](docs/roadmap.md) owns Gate 1 and G2 deadlines. The [work-in-progress map](docs/work-in-progress.md) is a dated snapshot of branch work.

## Documentation

- [Documentation index](docs/README.md)
- [Product brief and open decisions](docs/product.md)
- [GitHub issue and PR work in progress](docs/work-in-progress.md)
- [Current architecture and proposed expansion](ARCHITECTURE.md)
- [Working conventions](docs/project-organization.md)
- [Development journal](JOURNAL.md) and [worklog](WORKLOG.md)
- [Evaluation report](eval/results/report.md)
- [Demo materials status](presentation/README.md)
- [AI20K technical guide](docs/guide/chapter-01.md)

## Team

| Member | Student ID |
|---|---|
| Đặng Đỉnh Đoàn | 2A202602927 |
| Ngô Anh Khoa | 2A202602965 |
| Mai Quang Dũng | 2A202602966 |
| Nguyễn Dũng | 2A202602812 |

## AI usage logging

The repository includes hooks for AI usage logging. Each contributor can copy `.env.example` to `.env`, set their own `AI_LOG_API_KEY` from the [Phoenix dashboard](https://phoenix.note.transformerlabs.ai/api-keys), and run `bash scripts/setup_hooks.sh` (or `scripts/setup_hooks.ps1` in PowerShell). See [SECURITY.md](SECURITY.md) for credential handling.

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
