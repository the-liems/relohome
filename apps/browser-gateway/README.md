# ReloHome browser gateway

Installable package `relohome-browser-gateway`, import `relohome_gateway`.
Run `npm run dev:gateway` from the repository root after installing
`requirements-dev.txt`. Root commands set `RELOHOME_RUNTIME_ROOT`; direct Python
launches must set it to the absolute existing checkout/deployment root.

The combined [web image](../web/Dockerfile) serves `apps/web/dist` at port 8503.
Database, traveler key, housing media, cookies and API paths are unchanged.
See the [relocation and rollback guide](../../docs/integration/web-gateway-relocation.md)
for paths, tests and the tracked `Frontend.*` compatibility removal gates.
