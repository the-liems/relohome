# ReloHome Intake

Retained standalone compatibility harness; the integrated graph remains in
`apps/agent-api`. Distribution: `relohome-intake-api`; namespace: `relohome_intake`.

From the repository root run `npm run setup:python` (also after an existing
checkout is updated), then `npm run dev:intake`. For a direct installed launch,
set `RELOHOME_RUNTIME_ROOT` to the absolute existing checkout/deployment root:

```sh
python -m uvicorn relohome_intake.app:app --host 0.0.0.0 --port 8011
docker build -f Dockerfile.agents --target intake -t lifeflow-intake:local .
```

The image still listens on port 8000 and uses UID 10001. Compose, image/health
names and HTTP contracts are unchanged. Orchestrator resolves its defaults
`data/orchestrator.sqlite3` and `config/agent-services/registry.json` against the
configured runtime root; keep existing data volumes and permissions.

See the [standalone runbook](../../docs/runbooks/agent-services.md) and
[relocation/rollback](../../docs/integration/agent-app-relocation.md).
