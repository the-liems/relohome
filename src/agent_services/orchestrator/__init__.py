"""Temporary launch compatibility; removal gate #115, see docs/integration/agent-app-relocation.md."""

if __name__ == "relohome_orchestrator":
    raise ImportError(
        "Stale editable install maps relohome_orchestrator to src/agent_services/orchestrator/; "
        "run `npm run setup:python` from the repository root "
        "to reinstall from apps/orchestrator-api."
    )
