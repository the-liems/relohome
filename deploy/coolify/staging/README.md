# Staging deployment on Coolify

**CI** builds the application images and pushes them to GHCR. The separate
**Deploy staging** workflow saves the selected release's Compose definition in
Coolify and submits a restart request for the existing staging Service. Coolify handles rollout completion and container health.
No GitHub App or deploy key is needed.

## Files and release flow

- `.github/workflows/ci.yml` contains an explicit matrix of nine ARM64 images.
  Each entry names its Dockerfile, build context and target. Builds use normal
  `docker build` and `docker push` commands; they need no runtime credentials.
- `.github/workflows/deploy-staging.yml` deploys a successful main CI run,
  automatically after CI completes or manually by CI run ID. It never builds images.
- `compose.coolify.yaml` is the image-only source of truth for services,
  environment references, health checks, networks and volumes.
- `scripts/deploy-coolify.py` replaces only `${IMAGE_PREFIX}` and `${RELEASE_TAG}`,
  saves the resulting Compose file, updates Coolify and
  submits the deployment request. Other variables are left for Coolify to resolve.

The workflow uses each service's Dockerfile:

| Images | Dockerfile | Build context |
| --- | --- | --- |
| `web` | `Frontend/Dockerfile` | Repository root |
| `backend` | `Dockerfile` | Repository root |
| `platform`, `location-migrate` | `Maps VN/LifeFlow/platform-api/Dockerfile` | `Maps VN/LifeFlow` |
| `location` | `Maps VN/LifeFlow/mcp-server/Dockerfile` | `Maps VN/LifeFlow` |
| `flights-mcp` | `src/mcp_servers/flights/Dockerfile` | Repository root |
| `moving-api`, `moving-mcp`, `moving-migrate` | `Maps VN/LifeFlow/Dockerfile.moving` | `Maps VN/LifeFlow` |

Coolify pulls these images; GitHub Actions builds them. Dockerfiles are shared
with other deployment methods and have no Coolify-specific build requirements.

The Python test job runs backend, gateway and deployment tests together.

PRs run application and deployment tests and image builds without publishing
or deploying. Main-branch runs publish after those checks pass. Images use
`ghcr.io/ai20k-build-phase-cohort-4/p-044/<service>:<commit>-<run-id>`.
Rerunning failed jobs keeps the same tag so images from successful matrix jobs
remain available. Start a new workflow run for a new release; retain deployed
image tags for rollback. Deployment uses the source CI run's commit and run ID,
not the deployment workflow's own SHA or run ID.

PostGIS uses the separately published `postgis:16-3.5-alpine` tag. It is not built
by this workflow. Database tags remain mutable by choice: republishing PostGIS
or an upstream `postgres:16-bookworm` update can change the database image at the
next deployment, even when Compose is unchanged. Retain backups and review
image updates; tags do not provide reproducible database-image rollback. Digest
pinning can be adopted when database upgrades need explicit Git approval.

The separate Moving publishing workflow remains available;
this stack builds its Moving images with the same release tag as the other apps.

## Create or reuse the staging Service

1. Open `https://coolify.c4-app-044.io.vn` → **P-044 → staging**.
2. Create **Docker Compose Empty** on the ARM64 server, or reuse the resource
   already created for this stack. Save the bootstrap definition below, which
   starts PostGIS and a temporary container for preparing the routing volume.
3. Copy the parent **Service UUID** from the resource URL. Do not use the
   project, environment, server or individual component UUID.
4. Authenticate Docker to GHCR as the SSH user configured for the server in
   Coolify. The pulling account needs access to each application package.

```yaml
services:
  postgis:
    image: ghcr.io/ai20k-build-phase-cohort-4/p-044/postgis:16-3.5-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-p044_location}
      POSTGRES_USER: ${POSTGRES_ADMIN_USER:-p044_location_admin}
      POSTGRES_PASSWORD: ${POSTGRES_ADMIN_PASSWORD:?}
    volumes: [location-data:/var/lib/postgresql/data]
  routing-data:
    image: alpine:3
    command: [sleep, infinity]
    restart: unless-stopped
    exclude_from_hc: true
    volumes: [routing-data:/data:ro]
volumes:
  location-data:
  routing-data:
```

Keep the same Service and volume names when expanding to the full stack. No
public port or domain is needed for PostgreSQL. For an existing Debian database,
restore a logical dump into a fresh Alpine volume instead of reusing its data
directory. Choose database names and usernames before initialization; changing
variables later does not rename an existing database or rotate its password.

## Configure GitHub

Configure these repository Actions settings before merging the workflow:
successful `main` builds automatically trigger **Deploy staging** while that
workflow is enabled.

| Setting | Location | Value |
| --- | --- | --- |
| `COOLIFY_TOKEN` | Repository secret | Coolify token with `read`, `read:sensitive`, `write`, `deploy` |
| `COOLIFY_CA_CERT` | Repository secret, optional | Private CA PEM if needed |
| `COOLIFY_SERVICE_UUID` | Repository variable | Parent Service UUID |
| `COOLIFY_URL` | Repository variable, optional | Defaults to `https://coolify.c4-app-044.io.vn` |

```sh
gh secret set COOLIFY_TOKEN
gh variable set COOLIFY_SERVICE_UUID --body '<service-uuid>'
```

Create the API token while the Coolify team that owns **P-044** is selected.
The workflow needs all four listed abilities: it reads Compose and resolved
variables, updates Compose, and requests a restart. In the Coolify dashboard,
selecting **Deploy** clears the other selections, so select it first, then
**Write** and **Read sensitive data** (which also adds **Read**). Verify all four
appear before creating the token. Choose a long expiry or none; the default is
30 days, after which CD fails with HTTP 401. Copy the complete token, including
its numeric prefix and `|` separator, into the repository secret.

Enable API access in Coolify. The API token controls Coolify; the server's GHCR
credential separately authorizes image pulls. Never place either in Compose.
GitHub uses its built-in `GITHUB_TOKEN` for publishing.

Complete the one-time resource setup, runtime variables and data preparation in
Coolify before the first deployment. Successful main-branch **CI** runs trigger
**Deploy staging**, including manual **CI → Run workflow → main** builds.
The deployment run's `coolify-staging-<release-tag>` artifact contains
`coolify-release.yaml` with release tags and runtime variable references, not
secret values.

## Configure runtime values and data

Add these values manually in the Coolify Service's Environment Variables before
the first CD run, even while the resource contains only the bootstrap services:

| Variables | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `AGENT_MODEL` | LLM credentials and model selection |
| `AGENT_API_TOKEN`, `LOCATION_MCP_AUTH_TOKEN`, `MOVING_MCP_AUTH_TOKEN` | Independent internal service tokens |
| `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD`, `POSTGRES_INGEST_PASSWORD` | Separate Location database roles |
| `MOVING_DB_ADMIN_PASSWORD`, `MOVING_DB_APP_PASSWORD` | Separate Moving database roles; use URL-safe passwords |
| `FLIGHT_SERPAPI_API_KEY` | Flight search |
| `PAYMENT_ZALOPAY_APP_ID`, `PAYMENT_ZALOPAY_KEY1`, `PAYMENT_ZALOPAY_KEY2` | ZaloPay sandbox |
| Both `AHAMOVE_API_KEY` and `AHAMOVE_MOBILE`, or `AHAMOVE_USER_TOKEN` | AhaMove staging; CD requires one complete credential form before restarting |
| `AHAMOVE_WEBHOOK_SECRET` | Moving API authentication |
| `MOVING_QUOTE_CONTACT_NAME`, `MOVING_QUOTE_CONTACT_MOBILE` | Authorized quote contact |
| `APP_URL` | Public staging URL |

`AGENT_MODEL` is an optional Coolify setting, defaulting to `gpt-6-luna`.
Compose uses it to populate the seven service-specific `AGENT_*_MODEL` variables
that the backend reads.

Database names and role names have configurable defaults in Compose. Generate
independent internal secrets with `openssl rand -hex 32`. Runtime writes remain
disabled in this staging definition.

### In-app payment for the team test phase

The backend runs with `APP_ENV=staging` and in-app checkout on
([payment-design](../../../docs/review/payment-design.md)): ZaloPay **sandbox**
orders, simulated flight hold/ticket on the internal `flights-mcp`, and Moving
recorded as approved without an AhaMove order. Optional values:

| Variables | Purpose |
| --- | --- |
| `PAYMENT_TESTER_USER_IDS` | Comma-separated gateway account IDs allowed to use the "paid (tester)" control. Empty means nobody sees it |
| `SIU_TRAVELER_KEY` | Fernet key for flight booker profiles. Empty creates a key file in `web-data`; losing it makes saved profiles unreadable |

Testers register on the site first. Read their IDs from the web container, then
set the list and restart the backend:

```sh
docker exec <web-container> python -c "import sqlite3; print(sqlite3.connect('/app/data/siu-web.sqlite3').execute(\"select id from users where email in ('a@example.com')\").fetchall())"
```

The control also requires an awaiting, unexpired payment owned by that account,
and its result is labelled "marked by tester", separate from the gateway status.
Before outside users try the site, set `APP_ENV: production`, remove
`PAYMENT_TESTER_CONFIRM_ENABLED` and `PAYMENT_TESTER_USER_IDS`; the backend
refuses to start if the tester control is enabled in production.

### Housing owner workspace and Roommate

Optional values; the defaults keep both features safe to deploy:

| Variables | Purpose |
| --- | --- |
| `HOUSING_MODERATOR_IDS` | Comma-separated staging account IDs that verify posters and approve homes and listings. Empty means owner listings never go public |
| `HOST_TERMS_VERSION` | Empty: no poster-terms step. A value makes posters accept that version |
| `HOUSING_MESSAGE_RATE_PER_MINUTE` | Tenant–landlord messages one sender may post per minute (default 10) |
| `ROOMMATE_MODERATORS` | Comma-separated staging account IDs that moderate Roommate. Required before enabling it |
| `ROOMMATE_ENABLED` | `false` by default. Set `true` only after `ROOMMATE_MODERATORS`; the backend refuses to start Roommate without a moderator |

Account IDs come from the staging web database (command above), not from a local
machine. Restart `platform` after changing the Housing values and `backend` after
the Roommate values.

Roommate keeps `roommate.sqlite3` and its Fernet `contact.key` in the
`roommate-private` volume at `/app/private-roommate` (outside `/app/data`, which the
runtime rejects; the image creates it for the service user with mode 700). Back them
up **together**: take a consistent SQLite snapshot with `Connection.backup()` (or
stop the backend first) and store it with the matching key in encrypted storage with
restricted access. A database without its key cannot decrypt stored contacts; the
runtime never generates a replacement key for an existing database. Restore into a
new private directory and follow [the Roommate runbook](../../../docs/runbooks/roommate.md).
Demo profiles stay off on staging (`ROOMMATE_DEMO_ENABLED: "false"`): the backend
image does not include `data/`, so a demo would need its dataset mounted read-only.

Application images do not contain routing files or Location data. Prepare them
before merging:

1. Keep versioned copies of the Location dump and routing archives in private
   storage outside the deployment server, with SHA-256 checksums. The team's
   current snapshot must be obtained separately; this workflow does not fetch it.
2. Set the PostGIS variables and deploy the bootstrap definition. This creates
   `location-data` and `routing-data` in this Service before the full stack starts.
3. Find the temporary `routing-data` container in Coolify. On the server, inspect
   its `/data` mount to obtain the actual volume name; Coolify adds a resource
   identifier, so do not guess it or use another environment's volume:

   ```sh
   docker inspect <routing-data-container> --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'
   ```

4. Prepare a trusted `routing.tar.gz` whose root contains `hcm/`, `hanoi/`,
   `danang/` and `SHA256SUMS`. Each city contains `driving/`, `walking/` and
   `motorcycle/`, each with the complete `<city>.osrm*` file set. The checksum
   manifest uses paths relative to the archive root. Load the fresh volume and
   verify the files (replace `<routing-volume>` with the inspected name):

   ```sh
   docker run --rm -i -v <routing-volume>:/data alpine:3 sh -c 'tar -xzf - -C /data && cd /data && sha256sum -c SHA256SUMS' < routing.tar.gz
   ```

5. Verify that all nine datasets load with their service's OSRM image digest in
   `compose.coolify.yaml` before the full deployment. The `project-data-2026-10-05`
   snapshot has mixed graph formats: driving uses the v26.9.0 image pinned in
   `x-osrm-driving`, while walking and motorcycle use the v6.0.0 image in
   `x-osrm`. This matches `config/local-routing.compose.yaml`; do not replace
   those pins with one common image. The driving image has no `wget`, so its
   HTTP health check uses Bash's TCP support. OSRM graph formats depend
   on the version that built them; a checksum alone does not prove compatibility.
   If necessary, rebuild incompatible graphs with that image. Reproducible graph
   preparation and publishing are tracked separately in #77.

All nine OSRM services mount `routing-data:/data:ro` and read their own
`/data/<city>/<profile>/<city>.osrm` path. Preserve this volume when replacing the
bootstrap definition with the full stack. Repeat data preparation separately for
each environment. The temporary `routing-data` container is not part of the full
stack. Coolify may still list its old component after the container is removed;
confirm this during the first rollout. If it remains, leave the component alone
unless cleanup can explicitly preserve its volumes. Do not delete it with
**delete volumes** selected: its `routing-data` volume is shared by all nine OSRM
services. The possible stale UI entry is inferred from Coolify's parser and has
not been verified on this instance.

Resource sizing and container limits are outside this PR's scope. This Compose
definition currently sets no CPU or memory limits. Any future limits should be
based on host capacity and measured usage of the loaded datasets.

If importing a full Location database dump, use the bootstrap definition
above in this same resource to initialize a fresh database, restore the dump,
then run `ANALYZE` in the restored database. Let the first CD run apply the full
release Compose definition. Complete the restore before merging so the
application migrator starts afterward. The full definition creates application
roles and runs migrations before dependent services start. Preserve `location-data` throughout.

Once CD creates the `web` component, set only its domain, for example
`https://staging.c4-app-044.io.vn:8503`. The port tells the proxy where the web
container listens; browsers use HTTPS 443. Configure DNS to reach that server.
Save the domain and restart the Service in Coolify to apply its proxy routing.
Leave the other components private. Payment runs as the backend's stdio child.

The `web` labels block `/health` and FastAPI's `/docs`, `/redoc` and
`/openapi.json` at the proxy for that domain; they return 418. Docker's
healthcheck calls the container directly and is unaffected. The domain is written
literally because Coolify escapes `$` in labels, so update the rule if the domain
changes.

## Automatic deployment

Once the GitHub settings, Coolify resource, runtime values and data are ready,
merge the workflows. **CI** tests, builds and publishes all nine application
images. Its successful completion on `main` triggers **Deploy staging** through
`workflow_run`. Failed CI runs and PR runs cannot deploy. The deploy workflow
checks the source run's workflow, repository, branch, event and successful status
before selecting its `<commit>-<ci-run-id>` image tag. It loads Compose from that
exact commit while running deployment tooling from its own workflow revision.

CD uses `POST /services/{uuid}/restart?latest=true` for both initial deployment
and subsequent releases. Current Coolify pulls images, then recreates every
container in the stack, including its databases. CD requests the pull explicitly;
Compose does not force another pull during container creation. Expect staging
downtime on every release;
this is not a zero-downtime production rollout strategy.

Before contacting Coolify, CD checks the registry manifest of every distinct
image in the selected Compose definition using `docker manifest inspect`.
Missing tags, registry authorization failures and inspection timeouts stop the
job before changing the Service. It uses the job's `GITHUB_TOKEN` with
`packages: read` for GHCR; this repository must have Actions pull access to each
private package. The check does not pull layers, start containers or verify
application health. Image retention and Coolify's own pull credentials still
matter: availability can change after this check.

CD then saves and verifies the full Compose definition and checks required
variable values before restarting the Service. It validates the AhaMove credential
combination only when a service in that definition uses AhaMove auth variables.
AhaMove accepts a nonblank user token or both a nonblank API key and mobile
number; the check uses resolved Coolify values and does not contact AhaMove.
If a value is missing, the new definition
remains saved for configuration and retry; CD does not request a restart. Values are
never printed. The GitHub job succeeds once Coolify accepts the restart request.
It does not poll service status.

Follow deployment logs and container health in Coolify, and configure Coolify
notifications for operational alerts. A green GitHub submission job means the
request was accepted; rollout can still fail afterward in Coolify. Completion is
not automatically reported back to this GitHub job. Compose/Docker health checks
remain enabled for every long-running service. The `web` check confirms the
gateway's SQLite store is readable; it does not call other services.

Automatic and manual submissions share one staging concurrency group with
`queue: max` and `cancel-in-progress: false`. Up to 100 runs can wait; new arrivals
do not replace a pending rollback. GitHub cancels additional runs if the queue
is full. Queue order follows when runs start waiting, not commit order.

During initial release selection, automatic runs check that the source CI commit
equals main's current HEAD. Older automatic releases exit before checkout,
fetching Compose or setting up Python. A failed branch lookup fails without
changing Coolify. Manual submissions intentionally allow an older successful
main CI release. The check is a snapshot at selection time, not a lock on main.
The concurrency lock ends after submission and does not cover the subsequent
rollout in Coolify.

Before relying on automatic CD, verify these operations on the configured
staging instance: first deployment, a second deployment over the
running stack, and rollback using a retained Compose artifact. Check each
rollout in Coolify. Unit tests cover API submission, not a live rollout.
Also confirm that `curl -sk https://staging.c4-app-044.io.vn/health` and `/docs` return 418.

## Pause, resume and deploy manually

Once this workflow is merged into `main`, GitHub lists **CI** and **Deploy staging**
separately under Actions. To pause new deployments:

1. Open **Actions → Deploy staging → ⋯ → Disable workflow**.
2. CI continues testing, building and publishing images.
3. To resume, open the same workflow and select **Enable workflow**.

The equivalent CLI commands, run from this repository, are:

```sh
gh workflow disable deploy-staging.yml
gh workflow enable deploy-staging.yml
```

Disabling prevents new triggers; cancel any already queued or running deployment
runs separately. If a restart was already submitted to Coolify, GitHub cannot
undo it. Manage that rollout in Coolify.

To deploy an existing release after resuming, or retry deployment without rebuilding:

1. Find a successful **CI** run on `main`. Copy the numeric ID from its URL,
   for example `123456789` from `/actions/runs/123456789`.
2. Open **Actions → Deploy staging → Run workflow** and select branch **main**.
3. Enter that ID as **ci_run_id** and run the workflow.

```sh
gh workflow run deploy-staging.yml --ref main -f ci_run_id=123456789
```

The ID must identify this repository's successful main **CI** run, not a deployment
run or another workflow. All nine published images must still exist in GHCR.
Re-enabling the workflow does not itself deploy releases built while it was
paused; select a run manually or wait for a new successful main CI run.

Manual selection can redeploy an older release and its original Compose file.
New automatic releases can subsequently replace it; coordinate a rollback with
incoming main builds. To hold an older release, disable the deployment workflow
after its manual submission and check for already queued deployment runs.

## Infrastructure changes and rollback

Edit Compose in Git for service additions, networks, volumes, health checks and
resource limits. Those changes travel with the release. Direct Compose edits in
Coolify are overwritten on the next release; runtime secret values stay there.
For a new required variable, declare `${NAME:?}` and supply its value in Coolify
before startup. New custom images also need an entry in the workflow matrix.

Keep service and volume identities stable. A volume rename does not migrate its
data. Server provisioning, DNS, host files, data relocation and PostgreSQL major
upgrades require separate provisioning or migration work.

To roll back, manually run **Deploy staging** with a retained successful CI run
ID, or save a retained `coolify-release.yaml` to the same Service and deploy it
in Coolify. Retain its GHCR images and back up persistent volumes. Redeploying
old images does not reverse schema migrations or restore old volume contents.

The workflow automates staging only. Production will promote selected release
images with production configuration in its own environment/resource. Staging
and production may share or use different Coolify instances and servers.
