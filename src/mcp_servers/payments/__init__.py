"""Temporary launch compatibility; removal gate #115, see docs/integration/agent-app-relocation.md."""

if __name__ == "relohome_payments_mcp":
    raise ImportError(
        "Stale editable install maps relohome_payments_mcp to src/mcp_servers/payments/; "
        "run `npm run setup:python` from the repository root "
        "to reinstall from apps/payments-mcp."
    )

from relohome_payments_mcp import PaymentServices, build_services, create_server  # noqa: E402, F401
