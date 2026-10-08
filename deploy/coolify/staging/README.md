# Staging deployment on Coolify

GitHub Actions builds the application images, pushes them to GHCR, saves the
release's Compose definition in Coolify, and submits a restart request for the existing
staging Service. Coolify handles rollout completion and container health.
No GitHub App or deploy key is needed.

## Files and release flow

- `.github/workflows/ci.yml` contains an explicit matrix of nine ARM64 images.
  Each entry names its Dockerfile, build context and target. Builds use normal
  `docker build` and `docker push` commands; they need no runtime credentials.
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
image tags for rollback.

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
successful `main` builds automatically run staging CD.

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
Coolify before merging. Every successful main-branch run updates Compose and
requests deployment, including manual **CI → Run workflow → main** runs.
The `coolify-staging-<release-tag>` artifact contains `coolify-release.yaml` with
release tags and runtime variable references, not secret values.

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

5. Verify that all nine datasets load with the OSRM image digest in
   `compose.coolify.yaml` before the full deployment. OSRM graph formats depend
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
merge the workflow. The resulting main-branch run deploys after checks and all
nine image pushes succeed. Subsequent pushes and manual CI runs on `main` use
the same deployment flow.

CD uses `POST /services/{uuid}/restart?latest=true` for both initial deployment
and subsequent releases. Current Coolify pulls images, then recreates every
container in the stack, including its databases. CD requests the pull explicitly;
Compose does not force another pull during container creation. Expect staging
downtime on every release;
this is not a zero-downtime production rollout strategy.

CD saves and verifies the full Compose definition, then checks required variable
values and the AhaMove credential combination before restarting the Service.
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

Submission jobs are serialized for staging. Immediately before updating Coolify,
the job checks that the release commit still equals main's HEAD. Older runs are
skipped; a failed branch lookup fails the job without changing Coolify. The
concurrency lock is released after submission; it does not cover the subsequent rollout in Coolify.

Before relying on automatic CD, verify these operations on the configured
staging instance: first deployment, a second deployment over the
running stack, and rollback using a retained Compose artifact. Check each
rollout in Coolify. Unit tests cover API submission, not a live rollout.
Also confirm that `curl -sk https://staging.c4-app-044.io.vn/health` and `/docs` return 418.

## Infrastructure changes and rollback

Edit Compose in Git for service additions, networks, volumes, health checks and
resource limits. Those changes travel with the release. Direct Compose edits in
Coolify are overwritten on the next release; runtime secret values stay there.
For a new required variable, declare `${NAME:?}` and supply its value in Coolify
before startup. New custom images also need an entry in the workflow matrix.

Keep service and volume identities stable. A volume rename does not migrate its
data. Server provisioning, DNS, host files, data relocation and PostgreSQL major
upgrades require separate provisioning or migration work.

To roll back, save a retained release's `coolify-release.yaml` to the same Service
and deploy it. Retain its GHCR images and back up persistent volumes. Redeploying
old images does not reverse schema migrations or restore old volume contents.

The workflow automates staging only. Production will promote selected release
images with production configuration in its own environment/resource. Staging
and production may share or use different Coolify instances and servers.
