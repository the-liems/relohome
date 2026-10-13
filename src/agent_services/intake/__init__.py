"""Temporary launch compatibility; removal gate #115, see docs/integration/agent-app-relocation.md."""

if __name__ == "relohome_intake":
    raise ImportError(
        "Stale editable install maps relohome_intake to src/agent_services/intake/; "
        "run `npm run setup:python` from the repository root "
        "to reinstall from apps/intake-api."
    )
