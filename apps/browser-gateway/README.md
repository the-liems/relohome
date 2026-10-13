# ReloHome browser gateway

Installable package `relohome-browser-gateway`, import `relohome_gateway`.
Run `npm run dev:gateway` from the repository root after installing
`requirements-dev.txt`. Root commands set `RELOHOME_RUNTIME_ROOT`; direct Python
launches must set it to the absolute existing checkout/deployment root.

The combined [web image](../web/Dockerfile) serves `apps/web/dist` at port 8503.
Database, traveler key, housing media, cookies and API paths are unchanged.
See the [relocation and rollback guide](../../docs/integration/web-gateway-relocation.md)
for paths and tests; [shim retirement](../../docs/integration/python-examples-and-shims.md) records the completed caller migration and remaining validation gates.

Operator tools are installed in the same package:
`python -m relohome_gateway.admin_provision` and
`python -m relohome_gateway.cloud_backup`. Both use `RELOHOME_RUNTIME_ROOT` and
the gateway's database/media/key settings, including relative paths. See the
[Housing cloud runbook](../../docs/runbooks/housing-cloud.md) for Admin provisioning
in the Coolify `web` terminal and redeployment after permission changes.
