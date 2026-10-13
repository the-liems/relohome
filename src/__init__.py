"""Temporary launch compatibility; removal gate #115, see docs/integration/agent-app-relocation.md."""

if __name__ == "relohome_agent":
    raise ImportError(
        "Stale editable install maps relohome_agent to src/; "
        "run `npm run setup:python` from the repository root "
        "to reinstall from apps/agent-api."
    )
