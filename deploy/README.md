# Git-pinned deployment on Coolify

## How a release works

One commit SHA selects [Compose from Git](../compose.coolify.yaml) at that commit,
application images `ghcr.io/ai20k-build-phase-cohort-4/p-044/<svc>:<sha>` built
and published by CI on `main`, and the data blob pins in that Compose file.
The [image catalog](../config/ci/application-images.json) lists all eleven
application images, including the provisioner. Coolify resolves `SOURCE_COMMIT`
to the selected commit; it pulls the images rather than building them.

Startup dependencies are:

- `provisioner` → the nine OSRM services, with read-only routing mounts.
- Healthy `postgis` + completed `provisioner` → `location-seed` →
  `location-migrate` → `platform` and `location`.
- Healthy `moving-db` → `moving-migrate` → `moving-mcp` and `moving-api`.
- Healthy `location`, `moving-mcp`, `flights-mcp` and `payments-mcp` → `backend`.
- Healthy `backend` and `platform` → `web`.

## Data model

The private S3 bucket is a flat content-addressed blob store:
`s3://<bucket>/<sha256>.tar.gz`. The hash is of the compressed archive.

`routing-data` is rebuilt from its pinned blob on every deploy. OSRM mounts it
read-only. `location-data` is seeded from the dump only when
`public.lifeflow_schema_migrations` does not exist; later deployments skip the
restore and run migrations. The check is for that table, not database emptiness.

`blob-cache` keeps downloads under `<sha256>.tar.gz`, verified before entering
the cache. A cached file is never re-downloaded or re-verified. The provisioner
extracts the pinned location archive into the dedicated `location-seed-data`
volume; `location-seed` reads `lifeflow.dump` from that volume read-only.

## One-time S3 setup

Create a private bucket. From the directory containing the snapshot, pack and
upload these archives:

```sh
export COPYFILE_DISABLE=1   # macOS: keep ._ metadata files out of the archives
tar -czf routing.tar.gz  -C Routing .
tar -czf location.tar.gz -C project-data-2026-10-11/database lifeflow.dump
for f in routing.tar.gz location.tar.gz; do
  sha=$(sha256sum "$f" | cut -d' ' -f1)
  aws s3 cp "$f" "s3://<bucket>/$sha.tar.gz"
  echo "$f -> $sha.tar.gz"
done
```

Use an upload credential for this step. Give the deployment a separate read-only
key with `s3:GetObject` on `arn:aws:s3:::<bucket>/*`.

Replace the placeholder names in `compose.coolify.yaml`: put the routing and
location dump names in the provisioner's `SYNC_TARGETS` entries
(`routing-data=<sha256>.tar.gz` and `location-seed-data=<sha256>.tar.gz`), and
keep the dump name in `x-blobs.location-dump` aligned. Commit those pins before
deploying.
The routing archive must contain `hcm/`, `hanoi/` and `danang/`, each with
`driving/`, `walking/` and `motorcycle/` and the complete `<city>.osrm*` files.
Keep the OSRM image pins compatible with the graphs; driving uses a different
image from walking/motorcycle.

For S3-compatible stores, set `DATA_S3_ENDPOINT` on the Application. Pass the
same endpoint with `aws --endpoint-url <endpoint> s3 cp` when uploading.

## One-time Coolify setup per environment

The organization blocks deploy keys and GitHub Apps, so Coolify clones this
private repository with a personal access token in the repository URL. Create a
token that can read this repository: a fine-grained token with **Contents:
read-only** on `P-044` if the organization allows fine-grained tokens, otherwise
a classic token with `repo` scope. Create the Application as a **Public
Repository** with this URL, the Docker Compose build pack, branch `main` and
Compose file `/compose.coolify.yaml`:

```text
https://x-access-token:<token>@github.com/AI20K-Build-Phase-Cohort-4/P-044.git
```

Coolify stores the token in the Application. When it expires or is revoked,
deployments fail at the clone step; replace the URL with a new token.
Use an ARM64 server. Give staging and production separate Applications and
volumes. Set the `web` service domain with target port **8503**; keep the other
services private.

Set the existing runtime values described below and `DATA_S3_BUCKET`,
`DATA_S3_ACCESS_KEY_ID`, `DATA_S3_SECRET_ACCESS_KEY`, `DATA_S3_REGION`, and
optionally `DATA_S3_ENDPOINT`. These are all the required (`:?`) Compose inputs:

| Required variables | Purpose |
| --- | --- |
| `DATA_S3_BUCKET`, `DATA_S3_ACCESS_KEY_ID`, `DATA_S3_SECRET_ACCESS_KEY`, `DATA_S3_REGION` | Blob downloads |
| `SERVICE_URL_WEB` | Public application origin, supplied by Coolify from the web domain |
| `OPENAI_API_KEY` | LLM access |
| `AGENT_API_TOKEN`, `LOCATION_MCP_AUTH_TOKEN`, `MOVING_MCP_AUTH_TOKEN`, `FLIGHT_MCP_AUTH_TOKEN`, `PAYMENT_MCP_AUTH_TOKEN` | Internal service authentication |
| `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_APP_PASSWORD`, `POSTGRES_INGEST_PASSWORD` | Location database roles |
| `MOVING_DB_ADMIN_PASSWORD`, `MOVING_DB_APP_PASSWORD` | Moving database roles |
| `FLIGHT_SERPAPI_API_KEY` | Flight search |
| `PAYMENT_ZALOPAY_APP_ID`, `PAYMENT_ZALOPAY_KEY1`, `PAYMENT_ZALOPAY_KEY2` | ZaloPay sandbox |
| `AHAMOVE_WEBHOOK_SECRET` | Moving webhook authentication |

The server must be logged in to GHCR as the user Coolify uses for pulls, with a
classic PAT with `read:packages` and access to the private application and
PostGIS packages. On that server:

```sh
docker login ghcr.io --username <github-user>
```

Enter the PAT at the password prompt. This is separate from CI's `GITHUB_TOKEN`.
CD sets `git_commit_sha`, turns auto-deploy off, turns **include source commit**
on, and turns label escaping off. Do not change those settings by hand.

## One-time GitHub setup

Set these repository Actions variables and secrets:

| Type | Names |
| --- | --- |
| Variables | `COOLIFY_STAGING_URL`, `COOLIFY_STAGING_APP_UUID`, `COOLIFY_PRODUCTION_URL`, `COOLIFY_PRODUCTION_APP_UUID` |
| Secrets | `COOLIFY_STAGING_TOKEN`, `COOLIFY_PRODUCTION_TOKEN` |
| Optional variable | `STAGING_AUTO_DEPLOY=false` pauses automatic staging deployment |

URLs are HTTPS Coolify origins. UUIDs identify the new Applications. Tokens need
`read`, `read:sensitive` (so failed deployments print their log tail), `write`
and `deploy` abilities for their selected resources. Old Coolify
Service UUID variables can be deleted after cutover. The runner needs Python,
Docker CLI for manifest checks, and outbound HTTPS access to Coolify and GHCR;
see [self-hosted CI](../docs/runbooks/self-hosted-ci.md).

## Deploying

A green push CI run on `main` triggers automatic staging deployment. Automatic
selection skips a commit if `main` has already moved past it. Manual CI runs do
not trigger a deployment. `STAGING_AUTO_DEPLOY=false` leaves manual deploys
available; remove it or set it to `true` to resume automatic staging.

Run **Deploy to Coolify** from `main`, choosing `environment` and optionally a
full 40-character `sha`. The default is current `main` HEAD. The SHA must be an
ancestor of `main`, and its application image tags must exist in GHCR.

```sh
gh workflow run deploy.yml --ref main -f environment=staging
gh workflow run deploy.yml --ref main -f environment=production -f sha=<40-character-main-sha>
```

Verify a SHA on staging before selecting it for production. The workflow does
not enforce that operator check. Deployments are serialized per environment.

Success means Coolify reports the deployment `finished`, its commit matches the
requested SHA, and the Application reaches `running:healthy`. CD checks the
SHA-tagged application manifests first, waits up to 50 minutes for deployment
and then up to 10 minutes for health; the job has a 75-minute limit overall.
The job summary records the environment, commit and blob pins.

On failure, read the GitHub job log. A failed, cancelled or timed-out Coolify
deployment prints the last 40 non-hidden log lines. For API, commit or health
errors, follow the reported error and inspect that deployment in Coolify.

## Rollback

Only commits at or after this deployment change can be deployed or rolled back to; older commits use the retired Service-based flow and CD rejects them.

Dispatch the same workflow with an older full SHA on `main`:

```sh
gh workflow run deploy.yml --ref main -f environment=staging -f sha=<older-40-character-main-sha>
```

Its Compose, application images and data pins come with it. Retain the required
GHCR tags and S3 blobs. The database is never re-seeded by a rollback of an
initialized database; migrations are forward-only. Rollback does not restore
volume contents, reverse migrations, or undo payments/bookings. Check schema
compatibility and keep backups. Automatic staging can replace a rollback after
the next green main push; pause it when holding an older release.

## Changing data

Upload a new archive under its hash, change the relevant Compose pin in a commit,
and merge. Routing switches on the next deploy. A new dump pin only affects
fresh databases without the migration table; it does not update existing data.

## Maintenance

To clear `blob-cache`, remove that Application's cache volume on the server when
no deployment is using it. Inspect the provisioner's `/cache` mount for its actual
volume name; the next deploy re-downloads the pinned blobs. Preserve the other
volumes.

Every deploy re-extracts routing, even when its pin is unchanged. Allow disk
space and extraction time; a cache hit avoids the download, not the disk work.

## Cutover from the old Coolify Service

Create the new Application and verify it on a temporary domain if wanted. Stop
the old Service, then move the domain to the new Application.

The new Application has new volumes. Staging's Location database and routing
start from the pinned snapshot; other stores start fresh. Data written to the
old Service since the snapshot is not carried over, including accounts,
payments, Roommate and agent state. Copying or reconciling old state is separate
migration work.

## Runtime configuration

Set values per Application. Choose database/role names before initialization;
Compose supplies defaults. Use independent database passwords, internal tokens
and webhook secrets. Generate secrets with:

```sh
openssl rand -hex 32
```

Use URL-safe Moving database passwords because Compose embeds them in database
URLs. `AGENT_MODEL` is optional, defaulting to `gpt-6-luna`; it supplies all seven
backend agent model settings. Supply either `AHAMOVE_USER_TOKEN` or both
`AHAMOVE_API_KEY` and `AHAMOVE_MOBILE` for AhaMove, and authorized
`MOVING_QUOTE_CONTACT_NAME` / `MOVING_QUOTE_CONTACT_MOBILE` for quotes. CD does
not validate that credential combination.

Set the `web` domain to the public HTTPS origin. Coolify supplies `SERVICE_URL_WEB`
for public URLs and payment redirects; no separate `APP_URL` is required.
Enable **Preserve repository during deployment** for the embedded Collector config.
See the [Collector setup and migration](../docs/runbooks/observability.md#replace-standalone-collectors).
The shared observability ingestion network must exist before application deployment.
Web labels block public `/health`, `/docs`, `/redoc` and `/openapi.json` for the
configured web hostname; container health checks call the service directly.
Additional domain aliases need corresponding blocking rules in Compose.
`SIU_ALLOW_REGISTRATION` defaults to `true`.

### In-app payment for the team test phase

The current Compose defaults to `APP_ENV=staging` with in-app checkout enabled:
ZaloPay sandbox orders, simulated flight holds/tickets on internal `flights-mcp`,
and Moving recorded as approved without an AhaMove order. Agent and AhaMove
transaction writes stay disabled. See [payment design](../docs/review/payment-design.md).

| Optional variable | Purpose |
| --- | --- |
| `PAYMENT_TESTER_CONFIRM_ENABLED` | Default `true` for team testing; set `false` with `APP_ENV=production` |
| `PAYMENT_TESTER_USER_IDS` | Comma-separated gateway account IDs allowed to use the paid tester control; empty hides it |
| `PAYMENT_RECONCILE_ACTIVE_SECONDS` | ZaloPay checks while an order is payable; default 10 seconds, plus a check just before expiry |
| `SIU_TRAVELER_KEY` | Fernet key for flight booker profiles; empty creates a key file in `web-data` |

Testers register on the target site first. Read their IDs from that web container,
set the list, and redeploy:

```sh
docker exec <web-container> python -c "import sqlite3; print(sqlite3.connect('/app/data/siu-web.sqlite3').execute(\"select id from users where email in ('a@example.com')\").fetchall())"
```

The control requires an awaiting, unexpired payment owned by that account. Its
result is labelled marked by tester separately from gateway status. Preserve the
traveler key with the web database; losing it makes saved profiles unreadable.
Before outside users try the site, set `PAYMENT_TESTER_CONFIRM_ENABLED=false` on
the Application, remove the tester IDs and set `APP_ENV=production`. The backend refuses an enabled
tester control in production. Real provider transactions need separate
application/configuration work.

### Housing owner workspace and Roommate

| Optional variable | Purpose |
| --- | --- |
| `VIETMAP_API_KEY` | Server-only owner address lookup on Platform; never put it in `VITE_*` |
| `HOUSING_MODERATOR_IDS` | Account IDs that verify posters and approve homes/listings; empty keeps owner listings private |
| `HOST_TERMS_VERSION` | Empty skips poster terms; a value requires acceptance of that version |
| `HOUSING_MESSAGE_RATE_PER_MINUTE` | Messages per sender per minute; default 10 |
| `HOUSING_VIEWING_PROPOSAL_DAYS` | Days ahead a landlord may propose replacement viewing times; default 7, passed to backend and platform |
| `ROOMMATE_MODERATORS` | Account IDs that moderate Roommate; required before enabling it |
| `ROOMMATE_ENABLED` | Default `false`; enabling without moderators prevents startup |

Use IDs from the target web database, not a local machine. Redeploy after
changing environment values so `platform` receives the Housing settings and
`backend` receives the Roommate settings. Restarting an existing container alone
does not apply new environment values.

By default, Roommate stores `roommate.sqlite3` and its Fernet `contact.key` in
`roommate-private` at `/app/private-roommate`, outside `/app/data`. Back them up
together: use `Connection.backup()` for a consistent SQLite snapshot, or stop the
backend first, then store the snapshot and matching key in encrypted storage with
restricted access. An existing database never gets a replacement key. Restore
into a new private directory using the [Roommate runbook](../docs/runbooks/roommate.md).
Roommate demo profiles stay disabled. Switching `ROOMMATE_STORAGE` to PostgreSQL
needs an explicit provisioning/import step and a stable `ROOMMATE_CONTACT_KEY`;
see that runbook. Deployment does not migrate existing private SQLite state.

### Provider configuration

Choosing the production deployment environment preserves the same team-test
application defaults. Leave `PAYMENT_TESTER_USER_IDS` empty to hide the tester
control. Provider settings are per Application, separate from the deployment
environment:

| Variable / setting | Default |
| --- | --- |
| `AHAMOVE_ENV` | `staging`; also supplies backend `MOVING_ENVIRONMENT` |
| `AHAMOVE_BASE_URL` | `https://partner-apistg.ahamove.com/v3` |
| `AHAMOVE_PRODUCTION_ENABLED` | `false`; production provider mode requires `true` |
| ZaloPay endpoint | Fixed at `https://sb-openapi.zalopay.vn/v2` |

For production provider accounts used read-only, set the matching environment,
official endpoint and credentials together. Do not mix sandbox credentials with
a production endpoint. `AGENT_WRITES_ENABLED` and `AHAMOVE_WRITE_ENABLED` remain
fixed off. Keep ZaloPay sandbox credentials for the current checkout.
