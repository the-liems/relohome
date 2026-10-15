# Internal MCP authentication

Flight, Payment, Location and Moving follow one bearer-token contract. Python
implements it in `packages/python/mcp-http/src/relohome_mcp_http/__init__.py`; TypeScript services share
`@relohome/mcp-core`. Both run the same authentication test vectors.

Each HTTP service requires `MCP_AUTH_TOKEN` before serving requests. Use a separate
random secret for each service, generated with `openssl rand -hex 32`. Tokens must
contain at least 32 ASCII bearer-token characters (`A-Z`, `a-z`, digits,
`-._~+/`, with optional trailing `=`). Missing or invalid configuration fails
startup without printing the credential. Local Python settings accept the matching
`FLIGHT_MCP_AUTH_TOKEN` or `PAYMENT_MCP_AUTH_TOKEN` as a compatibility alias; Moving
accepts `MOVING_MCP_AUTH_TOKEN`.

Application clients use `FLIGHT_MCP_AUTH_TOKEN`, `PAYMENT_MCP_AUTH_TOKEN`,
`LOCATION_MCP_AUTH_TOKEN` and `MOVING_MCP_AUTH_TOKEN`. Compose and the local launcher
map each service's secret into its own `MCP_AUTH_TOKEN`. Provider credentials stay
with their dedicated service.

Every MCP request must include exactly one `Authorization: Bearer <token>` header.
The scheme is case insensitive; require one space and the exact token, compared
in constant time.

Python services use the MCP SDK's `BearerAuthBackend`, `RequireAuthMiddleware`,
and `AuthContextMiddleware`, with a `ServiceTokenVerifier` for the pre-shared
secret. Missing, malformed or incorrect credentials receive HTTP 401 with the
SDK's `WWW-Authenticate: Bearer ...` challenge and
`{"error":"invalid_token","error_description":"Authentication required"}`.
A small request guard rejects duplicate Authorization headers with HTTP 400 and
browser-origin MCP requests with HTTP 403. These services have no OAuth issuer;
they do not publish OAuth discovery metadata or support interactive login.
`MCPServer` is used directly; `create_http_app` installs the SDK middleware on
MCP routes while leaving health probes public.

TypeScript services retain HTTP 401, `WWW-Authenticate: Bearer`,
`Cache-Control: no-store`, and `{"status":"error","code":"UNAUTHORIZED"}` for
missing, malformed, duplicate or incorrect credentials. Clients classify access
failures by HTTP status rather than depending on the service's error-body format.

Health/readiness routes remain available to container probes without a bearer
token. Existing Host/Origin restrictions remain service specific. Python services
reject browser-origin MCP requests; Moving permits only its configured origins;
Location retains its SDK host/origin validation. Browser login sessions and payment
webhook signatures have separate contracts.

Moving optionally accepts a distinct `MCP_WRITE_TOKEN` (compatibility alias
`MOVING_MCP_WRITE_TOKEN`), validated by the same rules. Its read credential cannot
authorize write tools. Other services retain their tool allowlists and checkout
approval checks. Rotate a service's secret together with its clients and restart
both; there is no shared token issuer or automatic rotation service.
