"""Temporary gateway launch compatibility; removal gate: #115, see docs/integration/web-gateway-relocation.md."""

# Pre-relocation editable finders load this directory under the canonical name.
# Fail before any forwarding module can accidentally import itself.
if __name__ == "relohome_gateway":
    raise ImportError(
        "Stale editable install maps relohome_gateway to Frontend/; "
        "run `npm run setup:python` from the repository root "
        "to reinstall the gateway from apps/browser-gateway."
    )
