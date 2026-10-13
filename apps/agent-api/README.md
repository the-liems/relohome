# ReloHome Agent API

Install from the repository root with `npm run setup:python`; repeat this after
updating an existing checkout so old editable mappings are replaced. Distribution:
`relohome-agent`; import namespace: `relohome_agent`.

Run `npm run dev:agent`, or set `RELOHOME_RUNTIME_ROOT` to the absolute existing
checkout/deployment root and run:

```sh
python -m uvicorn relohome_agent.main:app --host 0.0.0.0 --port 8000 --workers 1
python -m relohome_agent.agents.contracts.export_schema
```

Load the existing environment configuration before startup (including
`AGENT_SUBAGENTS=live` and the configured LLM key). The schema exporter writes
`docs/api/agent-contract` under the runtime root; `--output-dir` supports an
explicit absolute path or a path relative to that root.

Build with `docker build -f Dockerfile -t backend .` from the repository root.
The image installs wheels and runs the canonical module as UID 10001. `/health`,
port 8000, the single worker, runtime DB/checkpoints/PII key and Roommate paths
are unchanged. Flight/Payment clients use HTTP; checkout uses the shared
`relohome-flight` library for passenger schemas and age rules.

See [relocation and compatibility](../../docs/integration/agent-app-relocation.md)
and the [runtime runbook](../../docs/runbooks/local-mvp.md).
