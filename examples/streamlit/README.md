# ReloHome Streamlit demos

Supported local Flight, Payment and agent-chat examples. Install from the repository
root with `.venv/bin/python -m pip install -r requirements-dev.txt`. Distribution:
`relohome-demos`; imports: `relohome_demos`. The examples depend on shared Flight
and Payment libraries and use HTTP clients for application APIs/MCP servers.
No application package or checkout import-path injection is required.

From the repository root (Node 24, Python 3.11, existing `.env.local`):

| Demo | Root command | Port | Required service configuration |
| --- | --- | --- | --- |
| Flight | `make ui` / `npm run dev:flight-demo` | 8501 | `FLIGHT_MCP_URL`, optional `FLIGHT_MOCK_MCP_URL` / `FLIGHT_SERPAPI_MCP_URL`, `FLIGHT_MCP_AUTH_TOKEN` |
| Payment | `make ui-payment` / `npm run dev:payment-demo` | 8502 | `PAYMENT_MCP_URL`, optional `PAYMENT_MOCK_MCP_URL` / `PAYMENT_ZALOPAY_MCP_URL`, `PAYMENT_MCP_AUTH_TOKEN` |
| Agent chat | `make ui-agent-chat` / `npm run dev:agent-chat` | 8501 | `LIFEFLOW_API_BASE_URL` (fallback `http://127.0.0.1:8000/api/v1`), `AGENT_API_TOKEN` |

Flight and chat share Streamlit's existing default port; launch them separately
or pass an explicit `--server.port` override. Root launchers load `.env.local`,
keep the repository cwd and set `RELOHOME_RUNTIME_ROOT` to the existing root.
Direct launch: `python -m streamlit run examples/streamlit/src/relohome_demos/flight_demo.py`.
For installed wheels, pass the script path returned by
`importlib.resources.files('relohome_demos') / 'flight_demo.py'` instead.

Flight/Payment service storage stays at `./data/flights.db` and
`./data/payments.db`; local integration retains `data/integration-payments.db`.
Provider credentials and state belong to the running services. Reading a page
does not enable writes or provider calls. The chat token stays server-side;
local chat is not a public browser gateway. Existing write/sandbox opt-ins remain.

`examples/design-reference/` contains static HTML/image references only; it is
not a supported app or deployed asset bundle. Location examples now live in
`examples/location-streamlit/`; see the [location guide](../../docs/location/STREAMLIT_MVP.md).

See [migration/rollback evidence](../../docs/integration/python-examples-and-shims.md).
