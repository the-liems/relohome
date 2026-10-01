# THE LIEMS (P-044) — Multi-Service AI System

THE LIEMS is developing an AI system for people planning a relocation. Finding a home, arranging transport for belongings, and booking travel require separate vendors, repeated details, and decisions that affect one another. The intended product turns the customer's goal into one plan they can review, change, and approve step by step.

## Customer journey

1. Tell the AI system where and when you want to move, along with housing, travel, and budget constraints.
2. Compare housing options and select a destination. The selected address can feed the moving quote while travel options are searched where possible.
3. Review the combined plan, source and validity of quotes, estimated costs, dependencies, and missing decisions.
4. Approve each paid action separately, then follow its progress and any recovery or manual follow-up.

This is the **intended** experience. It is not a description of the example chat endpoint in this checkout. The [product brief](docs/product.md) gives the detailed customer flow and open decisions.

**Development status:** The API in this checkout provides a sample LangGraph chat flow. The relocation workflow and service integrations are in progress across the linked issues and PRs. See the [work-in-progress map](docs/work-in-progress.md) and [architecture](ARCHITECTURE.md) for the current implementation and planned components.

## Current application

- `GET /health` returns the application health and environment.
- `GET /api/v1/status` returns the example agent status.
- `POST /api/v1/chat` accepts `{"message": "..."}` and returns an example `response` and `analysis`. The two graph nodes currently echo the input through placeholder analysis and response text; they do not call an LLM or service.
- The example calculator tool is implemented, but it is not connected to the graph. Knowledge search is a stub.

The code is under `src/`; the tests under `tests/` cover the example API and graph structure. Current endpoint schemas are defined in [`src/models/schemas.py`](src/models/schemas.py).

## Run locally

Use a modern stable Python release (3.11 or newer). The Docker image currently uses Python 3.11. From the repository root:

```bash
python3 --version
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload --port 8000
```

The example chat flow returns placeholder text and does not call the LLM factory, so it needs no OpenAI key. To use an LLM, wire the factory into the graph and set `OPENAI_API_KEY` in `.env`. Do not commit `.env` or API keys. Swagger UI is at <http://localhost:8000/docs>.

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello"}'
```

The Makefile provides `make run`, `make test`, and `make lint` shortcuts. Run `pytest tests/ -v` and `ruff check src/ tests/` after installing dependencies. Docker users can run `docker compose up --build` after creating `.env`.

## Proposed product behavior

The [confirmed MVP scope](docs/product.md#mvp-scope) includes housing selection, moving services, and travel booking. The AI system will coordinate dependent steps, request approval for each paid action, show progress, and recover from partial failures. The [product brief](docs/product.md) owns the scope and open decisions; the [roadmap](docs/roadmap.md) lists the Gate 1 and G2 deadlines and required deliverables. This workflow is not yet available through the current API.

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
