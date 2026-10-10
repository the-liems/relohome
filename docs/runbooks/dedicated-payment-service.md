# Dedicated Flight and Payment services

The application connects to all configured provider services over MCP Streamable
HTTP. Flight and Payment clients have no stdio fallback and never launch a server.
Services have their own lifecycle, health checks, provider credentials and state.
Local startup uses separate `scripts/local-integration.py flight` and `payment`
commands; start both before `api`. Container deployments use service DNS names.

Coolify runs `payments-mcp` on its internal network, with no host port or public
route. Its persistent `payments-data` volume owns `payments.db`; the backend keeps
checkout/session/ownership records in `agent-data`. ZaloPay merchant keys are only
passed to the Payment container. Set separate random `FLIGHT_MCP_TOKEN` and
`PAYMENT_MCP_TOKEN` secrets in Coolify before deploying; clients send bearer tokens,
MCP endpoints reject missing/wrong tokens and browser-origin requests. Health
checks return metadata only. Sandbox checkout verifies the remote service reports
ZaloPay and the official sandbox environment before opening the application.

## Existing staging data

This change prepares deployment configuration; it does not deploy or migrate data.
For an existing installation, migrate Payment's SQLite database before starting
the new release. Otherwise existing payment references will point to an empty DB.

1. Stop the old backend and keep it stopped while copying payment state. Back up
   `agent-data`, including `payments.db` and any `payments.db-wal`/`payments.db-shm`
   companions. Use SQLite's backup API to produce a consistent `payments.db` copy;
   preserve its stored pseudonym salt and existing payment IDs.
2. Create the release's `payments-data` volume. Copy the backed-up `payments.db`
   into its root; set the volume directory and database ownership to UID/GID 10001
   (the existing `mcp` service user). Do not copy unrelated agent state or secrets.
3. Set the two service tokens, then start the new Payment service. Verify its
   `/health` reports `provider=zalopay`, `environment=sandbox`, `simulation=false`.
4. Start the backend with `PAYMENT_MCP_URL=http://payments-mcp:8766/mcp`. Verify an
   existing owned payment can be read before accepting new checkout requests.
   Preserve the original backup for rollback; do not run old and new payment
   writers concurrently. A rollback after new payments requires backing up the
   new Payment database and returning that current state to the old location.

The legacy Streamlit demos also connect over HTTP. Provider mode is configured on
the service; optional `FLIGHT_MOCK_MCP_URL`, `FLIGHT_SERPAPI_MCP_URL`,
`PAYMENT_MOCK_MCP_URL` and `PAYMENT_ZALOPAY_MCP_URL` select independently running
demo services. Passing a provider key to a UI does not reconfigure a remote server.
