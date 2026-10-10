# Production deployment on Coolify

**Deploy production** manually deploys the same application image tag and Compose
revision already checked in staging. It never rebuilds images. Coolify handles
rollout completion and container health; a green GitHub deployment job means the
restart request was accepted, not that the release is healthy.

Staging and production are separate environments and Services in the **P-044**
Coolify project. They can share an instance/server or use different ones. No
GitHub Environment, GitHub App or deploy key is required.

## One-time setup

1. In **P-044 → production**, create a Docker Compose Service on an ARM64 server.
   Use the [staging bootstrap Compose](../staging/README.md#create-or-reuse-the-staging-service)
   in this new resource. Copy its parent Service UUID from the URL.
2. Configure GHCR authentication for the SSH user Coolify uses on that server.
   The credential must pull all ten private application packages and PostGIS.
3. Configure these **repository** Actions settings in GitHub:

   | Type | Name | Value |
   | --- | --- | --- |
   | Variable | `COOLIFY_PRODUCTION_URL` | HTTPS origin of the production Coolify instance |
   | Variable | `COOLIFY_PRODUCTION_SERVICE_UUID` | Production parent Service UUID |
   | Secret | `COOLIFY_PRODUCTION_TOKEN` | Coolify API token with `read`, `read:sensitive`, `write`, `deploy` |

   The URL may equal `COOLIFY_STAGING_URL`. The Service UUID must identify the
   separate production resource. Use a dedicated token for production; tokens
   are authorized by Coolify and are not automatically scoped by these names.
   Both workflows verify HTTPS using the runner's normal trust store.

   ```sh
   gh variable set COOLIFY_PRODUCTION_URL --body 'https://your-coolify-host'
   gh variable set COOLIFY_PRODUCTION_SERVICE_UUID --body '<production-service-uuid>'
   gh secret set COOLIFY_PRODUCTION_TOKEN
   ```

4. Add the [runtime variables](../staging/README.md#configure-runtime-values-and-data)
   to the **production Service**. Generate independent database passwords,
   internal tokens and webhook secrets, including `FLIGHT_MCP_AUTH_TOKEN` and
   `PAYMENT_MCP_AUTH_TOKEN` for the standalone MCP services. Choose database/role names before
   initialization; the default names can be reused because this Service has
   its own databases and volumes. Set `APP_URL` to the production HTTPS origin,
   such as `https://app.example.com`, without a path or trailing slash.
   CD uses its host in the proxy rule that blocks public health/docs endpoints.
5. Deploy the bootstrap, then prepare the production Location database and all
   nine routing datasets using the same data preparation procedure. Inspect
   the new resource's volume mounts; do not reuse staging's database or volume
   names on the host. Keep backups before later schema or data changes.
6. Check the runner has Docker CLI (`docker manifest inspect`), Python and
   outbound HTTPS access to Coolify/GHCR. CD does not need a Docker daemon.

## Provider configuration

Deploying to the production Coolify resource preserves the current application's
team-test configuration (`APP_ENV=staging`): in-app ZaloPay sandbox checkout and
simulated flight bookings are enabled, while agent/AhaMove transaction writes
remain disabled. Leave `PAYMENT_TESTER_USER_IDS` empty to hide the tester paid
control. This deployment does not enable real provider transactions.

Provider settings are per Service, separate from the deployment environment:

| Coolify variable | Initial value / behavior |
| --- | --- |
| `AHAMOVE_ENV` | `staging` by default; also sets the backend's `MOVING_ENVIRONMENT` |
| `AHAMOVE_BASE_URL` | `https://partner-apistg.ahamove.com/v3` by default; must match the selected provider environment |
| `AHAMOVE_PRODUCTION_ENABLED` | `false` by default; AhaMove production mode requires `true` |
| Payment endpoint | Fixed at `https://sb-openapi.zalopay.vn/v2` for the current sandbox checkout |

If connecting production provider accounts for read-only use, set the matching
provider environment, official endpoint and credentials together. Do not mix
sandbox credentials with a production endpoint. `AGENT_WRITES_ENABLED` and
`AHAMOVE_WRITE_ENABLED` remain disabled. Keep ZaloPay sandbox credentials for
checkout; the endpoint is deliberately not configurable in this definition.
Changing the application from team-test mode to a real transaction deployment
requires separate application/configuration work.

## Promote a release

1. Use a successful **CI** run on `main` created after environment-aware Compose
   was merged. Deploy that run to staging and verify the app and rollout in
   Coolify. Production refuses older Compose revisions that hardcode staging.
2. Copy the numeric **CI run ID** from its Actions URL. Do not use the staging
   deployment run ID. All published image tags for that run must still exist.
3. Open **Actions → Deploy production → Run workflow**. Select **main**, enter
   `ci_run_id`, and run it. Only dispatches from `main` submit deployments.

   ```sh
   gh workflow run deploy-production.yml --ref main -f ci_run_id=123456789
   ```

4. Check rollout logs and health in the production Coolify Service. For the
   first full deployment, set the **web** component's domain to the same origin
   as `APP_URL`, with target port **8503**, save, and redeploy the parent Service
   so Coolify applies its routing labels. Point DNS at the chosen server.
5. Verify the public app. Retain the CI run ID and the deployment artifact
   `coolify-production-<commit>-<ci-run-id>` for rollback.

The operator confirms staging verification; CI does not poll health or assert
that a successful staging submission means a healthy release. There is no
GitHub Environment approval gate. Repository users allowed to dispatch the
workflow can deploy production.

CD fetches Compose from the selected CI commit and uses current deployment
tooling from `main`. It checks image availability, saves Compose, verifies
required Coolify variables, then submits a whole-stack restart. For a missing
runtime variable, supply it in Coolify and rerun the same CI run ID. A missing
or invalid `APP_URL` stops before Compose is updated. No secret values are
written to the deployment artifact or printed by the script.

## Pause, rollback and infrastructure changes

Disable/enable **Deploy production** in GitHub Actions independently of staging
and CI (or use `gh workflow disable deploy-production.yml` / `gh workflow enable
deploy-production.yml`). Cancel queued/running deployments separately. Once a
restart reaches Coolify, manage that rollout there.

To roll back, dispatch **Deploy production** with a retained, previously verified
CI run ID that supports environment-aware Compose. It restores that release's
app images and Compose, not previous database contents or schema. Keep data
backups and check migration compatibility first. Mutable PostGIS/PostgreSQL tags
can resolve to newer images even when selecting an older CI run.

Change services, volumes and health checks in `compose.coolify.yaml`, test the
release in staging, then promote that same CI run. Add new required Coolify
variables in each Service before deployment. Direct Compose edits in Coolify
are overwritten by CD. Server provisioning, data relocation, DNS and database
major upgrades need their own provisioning/migration steps; CD does not perform
those operations.

## Public domain and failed-deployment artifacts

Keep the web domain configured in Coolify identical to the `APP_URL` origin.
Additional aliases are not covered by the custom health/docs blocking router;
do not add them without extending that rule. CD rejects an `APP_URL` with a
trailing slash to keep the payment redirect URL valid.

If submission fails before the hostname can be resolved, the saved Compose
artifact is diagnostic and still contains `${DEPLOY_HOST}`. Do not deploy that
file manually. Fix the reported setting and rerun CD to generate the fully
rendered definition. Runtime secrets remain variable references in both files.
