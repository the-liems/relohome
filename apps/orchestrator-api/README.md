# ReloHome Routing Orchestrator

Retained standalone compatibility harness; the integrated graph remains in
`apps/agent-api`. Distribution: `relohome-orchestrator-api`; namespace: `relohome_orchestrator`.

From the repository root run `npm run setup:python` (also after an existing
checkout is updated), then `npm run dev:orchestrator`. For a direct installed launch,
set `RELOHOME_RUNTIME_ROOT` to the absolute existing checkout/deployment root:

```sh
python -m uvicorn relohome_orchestrator.app:app --host 0.0.0.0 --port 8012
docker build -f Dockerfile.agents --target orchestrator -t lifeflow-orchestrator:local .
```

The image still listens on port 8000 and uses UID 10001. Compose, image/health
names and HTTP contracts are unchanged. Orchestrator resolves its defaults
`data/orchestrator.sqlite3` and `config/agent-services/registry.json` against the
configured runtime root; keep existing data volumes and permissions.

See the [standalone runbook](../../docs/runbooks/agent-services.md) and
[relocation/rollback](../../docs/integration/agent-app-relocation.md).
