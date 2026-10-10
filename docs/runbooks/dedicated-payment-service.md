# Dedicated Flight and Payment services

The application connects to all configured provider services over MCP Streamable
HTTP. Flight and Payment clients have no stdio fallback and never launch a server.
Services have their own lifecycle, health checks, provider credentials and state.
Local startup uses separate `scripts/local-integration.py flight` and `payment`
commands; start both before `api`. Container deployments use service DNS names.

Coolify runs `payments-mcp` on its internal network, with no host port or public
route. Its persistent `payments-data` volume owns `payments.db`; the backend keeps
checkout/session/ownership records in `agent-data`. ZaloPay merchant keys are only
passed to the Payment container. Set separate random `FLIGHT_MCP_AUTH_TOKEN` and
`PAYMENT_MCP_AUTH_TOKEN` secrets in Coolify before deploying; clients send bearer tokens,
MCP endpoints reject missing/wrong tokens and browser-origin requests. Health
checks return metadata only. Sandbox checkout verifies the remote service reports
ZaloPay and the official sandbox environment before opening the application.

All four MCP services follow the [internal authentication contract](../specs/internal-mcp-auth.md).
Each server requires `MCP_AUTH_TOKEN`; Compose maps the matching scoped client
secret into that variable. Missing or invalid tokens fail startup. Keep each
service/client pair in sync when rotating secrets.

## Existing staging data

Merging this PR triggers staging deployment after successful main CI.
Complete these prerequisites before merging: configure separate Flight and Payment
tokens, validate the existing Location and Moving tokens against the internal
authentication contract, and prepare the Payment database migration. A configured
Moving write token must be valid and distinct from its read token.

For an existing installation, preserve Payment's SQLite database before the
automatic rollout starts. Otherwise existing checkout records will reference
payment IDs that the new service cannot find. An empty database is only appropriate
if the staging owner explicitly accepts losing access to the existing payment history.

For a fresh staging rollout approved by the owner, leave `payments-data` empty and
let the Payment service initialize its database on startup. No copy from
`agent-data` is needed. Existing checkout records can no longer resolve their old
payment IDs; create new checkout sessions after deployment. Configure and validate
the service tokens before merging, then verify Payment health and the backend
connection after the automatic rollout. The owner approved this fresh-database
path for the initial dedicated Payment service deployment.

1. Stop the old backend and keep it stopped while copying payment state. Back up
   `agent-data`, including `payments.db` and any `payments.db-wal`/`payments.db-shm`
   companions. Use SQLite's backup API to produce a consistent `payments.db` copy;
   preserve its stored pseudonym salt and existing payment IDs.
2. Create the release's `payments-data` volume. Copy the backed-up `payments.db`
   into its root; set the volume directory and database ownership to UID/GID 10001
   (the existing `mcp` service user). Do not copy unrelated agent state or secrets.
3. Before merging, set the two new service tokens and validate Location/Moving
   tokens. Keep the old backend stopped after taking the final database backup.
   Confirm the target volume is the exact volume Coolify will attach to Payment.
   Then merge; successful main CI automatically deploys the new stack. Verify
   Payment `/health` reports `provider=zalopay`, `environment=sandbox`, `simulation=false`.
4. The backend starts after Payment becomes healthy, with
   `PAYMENT_MCP_URL=http://payments-mcp:8766/mcp`. Verify an existing owned payment
   can be read before accepting new checkout requests.
   Preserve the original backup for rollback; do not run old and new payment
   writers concurrently. A rollback after new payments requires backing up the
   new Payment database and returning that current state to the old location.

The legacy Streamlit demos also connect over HTTP. Provider mode is configured on
the service; optional `FLIGHT_MOCK_MCP_URL`, `FLIGHT_SERPAPI_MCP_URL`,
`PAYMENT_MOCK_MCP_URL` and `PAYMENT_ZALOPAY_MCP_URL` select independently running
demo services. The UI does not accept provider credentials or reconfigure a remote server.
