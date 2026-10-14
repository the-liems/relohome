# Infrastructure plan: Coolify delivery and scaling

Status: planned delivery contract; existing host setup is recorded below.
Updated: 2026-10-06. This document defines delivery requirements; it does not
establish implemented automation. Deployment and production-readiness gates
remain to be verified.
The implemented delivery is now a Git-pinned Coolify Application; see the
[deployment runbook](../../deploy/README.md). Release-contract sections below
describe the earlier Service-based design.

Use Docker Compose for local development, GitHub Actions on self-hosted runners
for CI, and Coolify for staging and production delivery. Plan expansion through
Coolify host resizing/relocation or qualified multi-server deployment. Retain
portable release metadata and configuration as these needs evolve.

## Goals and boundaries

- Keep application, deployment, runner, and infrastructure configuration in P-044.
- Use short-lived branches and reviewed changes to `main`; no permanent infra branch.
- Automatically deploy successful releases to staging, not merely publish images.
- Promote the same tested set of service image digests to production without rebuilding.
- Keep hosting-specific behavior outside application code.
- Minimize recurring cost and operational work while acknowledging failure domains.

Record provider, region, capacity, production domain, budget, recovery objectives,
and a production latency objective before enabling delivery or changing
infrastructure. The latency objective must name the critical routes/operations,
percentile and threshold, representative load, and measurement window used by
the environment-operation gate. This document authorizes no cloud spending.
Implementation tasks and progress belong in GitHub Issues, not duplicated here.

## Confirmed setup and delivery choices

| Item | Decision or current setup |
|---|---|
| Deployment scope | Full integrated application: browser gateway/frontend, agent backend, domain services, databases, and routing services |
| Coolify instance | Existing self-hosted installation; supply its HTTPS origin as the runtime `COOLIFY_URL` input |
| Deployment CPU | ARM64; build and verify `linux/arm64` images |
| CI runners | Self-hosted Linux runners labeled `team-44`; application, Moving, and PostGIS image builds additionally require `ARM64` and verify native execution. The persistent runner on the Coolify host includes PR jobs with host Docker access; current exposure described below. See [runner requirements and recovery](../runbooks/self-hosted-ci.md#arm64-runner-availability-and-recovery) |
| Repository access | Organization blocks GitHub Apps and deploy keys; Coolify clones with a personal access token in the repository URL |
| Delivery source | GitHub Actions builds SHA-tagged images and publishes to GHCR; Coolify reads Compose from Git at the pinned commit and pulls the images |
| Registry access | Operator confirmed private-image pulling with a personal credential; verify permissions for each newly published application package |
| Environment domains | Staging and production have separate domains/resources; final application domain values are runtime setup inputs |

Sharing a physical server does not require sharing a Docker daemon. GHCR is the
handoff between the runner and Coolify; no local-image transfer or shared image
cache is part of the release contract. Co-location does not establish isolation
for untrusted PR execution or production readiness.

## Planned repository structure

This is the canonical deployment/infrastructure layout. Other plans link here
instead of maintaining another directory tree. Preserve existing application,
script, workflow, and test paths unless a reviewed change deliberately replaces them.

Existing entrypoints must not be mistaken for a unified integrated application
deployment:

| Existing file(s) | Current purpose |
|---|---|
| `Dockerfile`, `docker-compose.yml` | Partial backend/Flight/Payment stack; built images and data mounts, without source mounts or hot reload |
| [Local integration helper](../../scripts/local-integration.py), `config/local-integration.compose.yaml`, `config/local-routing.compose.yaml` | Integrated application orchestration, including Payment over stdio |
| `deploy/moving/compose.moving.yaml`, `deploy/moving/compose.moving.ci.yaml` | Moving runtime and disposable CI overlay |
| `compose.agents.yaml` | Separate legacy standalone-agent harness, not the integrated graph |
| `.github/workflows/ci.yml`, `.github/workflows/agent-services.yml` | Existing validation; standalone-agent images are built locally for CI and removed afterward |
| `.github/workflows/moving-containers.yml` | Existing Moving validation and GHCR publisher |

There is no root `compose.ci.yml`. Reuse the existing service stacks, overlays, and
test helpers; an integrated application Compose entrypoint needs an explicit owner
and integration plan, not a second parallel CI stack inferred from a placeholder.
The following paths are proposed as their functionality is implemented:

```text
deploy/
  README.md                        # Release contract and deployment entry points
  coolify/
    staging/                       # Non-secret resource specifications/configuration
    prod/                          # Non-secret resource specifications/configuration
infra/
  coolify/<installation>/          # Hosts, bootstrap, optional LB, recovery
  runners/                         # Self-hosted runner provisioning and maintenance
scripts/
  <delivery-helpers>                # Follow existing flat script conventions; exact filenames selected in implementation
.github/workflows/
  ci.yml                           # Existing validation; extend its change dispatcher deliberately
  moving-containers.yml            # Existing Moving publisher; retain package names and ownership
  agent-services.yml               # Existing standalone-agent validation/local image tests; no publishing
  release.yml                      # Proposed candidate assembly/staging role; may be a gated job in ci.yml
  promote.yml                      # Proposed workflow_dispatch from main, selecting a stable release
  infrastructure.yml               # Validate/plan; separately authorized changes
docs/
  architecture/infrastructure.md   # This plan
  architecture/migration-options.md # Destination choices and migration gates
```

`deploy/` describes the application runtime. `infra/` describes the machines,
deployment platform, and runners that support it. Neither directory contains
credentials, private keys, infrastructure state, or saved sensitive plans.

## Local development and CI

Package the integrated application described in [ARCHITECTURE.md](../../ARCHITECTURE.md)
and the [local application runbook](../runbooks/local-mvp.md), rather than only the backend.
Include its actual PostgreSQL/PostGIS and OSRM dependencies; do not add Redis,
pgvector, or workers without an implemented capability. Use equivalent dependency
versions locally and in hosted environments. Ordinary CI blocks external provider
access and uses explicit fixtures; live staging checks are separately authorized.

The root Compose currently uses built images and persistent data mounts; source
mounts/hot reload are proposed development conveniences, not implemented there.
Use the existing local integration helper for the integrated application. CI stacks
must use an explicit configuration with no dependency on a developer's `.env`, unique project
names, isolated disposable volumes, readiness checks, and no conflicting fixed
host ports. Collect logs before cleanup, including on failure. Cleanup must only
affect the current job's resources, never globally prune a shared Docker host.

Fix and verify container startup before enabling releases: dependencies must be
accessible to the non-root runtime user. Pin dependencies and base/service image
versions. Limit the Docker build context to application inputs; documentation or
infrastructure changes must not silently alter the application image.

## Project and environment model

Use one Coolify project with separate staging and production environments. Create
a **Docker Compose Empty Service** in each environment, with no Git source. CI
renders an image-only definition containing digest references, commands,
environment-variable references, volumes, health checks, and dependencies; no
`build:` sections or source rebuilds run in Coolify. This resource is a Coolify
Service, not a Git-based Compose Application or an individual Docker Image application.
See [Coolify's Compose resource types](https://coolify.io/docs/applications/builds/docker-compose).

The specification is the project/environment/resource model, not a fixed hosting
topology. Each environment records its Coolify endpoint, project/environment UUIDs,
Service UUID, server/destination selection, domains, and configuration as deployment
inputs. Coolify's [Service creation API](https://coolify.io/docs/api/endpoints/services/create-service)
accepts project, environment, and server identifiers independently. Resources in
the two environments can use the same server or different connected servers;
additional resources/servers do not change the release and promotion contract.
Provisioning or migrating state to a new destination is a separately reviewed
operation, not a claim that editing an environment label moves running data.

The integrated application runtime contains:

- `web`: built React assets and the Python session gateway, exposed through HTTPS.
- `backend`: FastAPI/LangGraph, one application worker, durable runtime stores,
  and the Payment stdio child process required by the integrated graph.
- Location MCP and Platform API, with a private PostGIS database and migration job.
- Moving MCP and API, with their separate private PostgreSQL database and migration job.
- Flight MCP and its persistent state.
- Nine private OSRM instances for three cities and three travel modes, with
  separately provisioned, verified routing datasets.

Only `web` gets a public domain initially. Internal APIs and databases remain
private. Give each environment distinct storage and credentials; retain the
database, session, workflow, payment, flight, and encryption-key state across
redeploys. Run migration jobs successfully before dependent applications start.
Restore required data before launching migrations against a full database dump.
Dataset revisions and compatible migrations are part of release verification,
not content silently baked into application images.

Coolify supports prebuilt images identified by SHA256 digest. Keep application
state outside replaceable containers and configure the exposed internal port,
domains, runtime settings, and health checks explicitly. Do not assume a Compose
rollout provides rolling or zero-downtime replacement; verify its actual behavior.

Staging and production are both maintained deployment environments. The delivery
contract requires the following controls regardless of the selected resource placement:

- Give staging and production different Coolify Service UUIDs, domains, resource
  networks, isolated databases/credentials, writable volumes, and secrets. Avoid
  fixed container names and conflicting host ports. Never attach staging to
  production storage or grant it production credentials. Routing datasets use a
  separate immutable directory per revision, with checksums and exact paths recorded
  in each environment's release. Environments may share read-only files only while
  pinned to the same verified revision. Provision staging's next revision at a new
  path; never overwrite files or retarget a shared `current` symlink. Production
  restarts keep its recorded dataset until explicit promotion changes that pin.
  Retain previous revisions for rollback; mutable state and migration targets stay
  environment-specific.
- Scope each deployment to its selected Service and record that environment's
  release/configuration identity. A staging update must not recreate production
  containers or change its pinned images, runtime settings, or data.
- Measure application, routing-service, Coolify/proxy, runner, and deployment
  working sets on each selected server. Set CPU/memory limits and retain headroom
  for replacements. Express Service limits
  in Compose and verify the resulting container settings on the installed version;
  see [Compose resource settings](https://docs.docker.com/reference/compose-file/services/).
  Bound build cache, image/log retention, and disk usage; resource caps alone do not
  isolate disk I/O or prevent host failure.
- Keep per-environment deployment locks. For resources sharing a server, also use
  one server-scoped queue/lock covering rollout, migrations, and verification;
  operations acquire locks in a consistent order. Production priority applies
  only to queued work. A promotion arriving during a staging deployment/migration
  waits for it to finish; it neither overlaps nor preempts the active operation.
  Coordinate server maintenance through the same exclusive scheduling boundary.
- Alert on server memory/disk pressure and production health/latency. Retain
  application and control-plane backups outside their failure domain, with tested
  restore procedures and recorded recovery objectives.

Keep databases private; expose only required application traffic and restrict
administrative access. If staging/CI share production's host, validate their
bounded workload and redeployment under representative production traffic before
accepting the capacity plan. Shared hosts, daemons, proxies, and disks remain
shared failure domains; environment labels do not establish HA or host security
isolation. Until a measured capacity plan is recorded, allow at most one build
at a time on the shared runner/host; any increase requires a reviewed capacity
decision. Concurrency limits are not a security boundary. Review and schedule
host/OS, Docker, and Coolify updates deliberately, including their impact on all
affected environments and the recovery procedure.

**Current exposure:** the [self-hosted CI runbook](../runbooks/self-hosted-ci.md)
and existing workflows route PR jobs as well as trusted jobs to the persistent
`team-44` runner. Its host Docker access is on the same server as Coolify. A PR
workflow allowed to execute there can control that daemon and potentially mount
host files; unique job resources and virtualenv cleanup do not isolate the host
or its deployment credentials. This is an existing gap, tracked in
[issue #61](https://github.com/AI20K-Build-Phase-Cohort-4/P-044/issues/61).
Restrict execution to reviewed trusted code while arranging the isolated PR
executor and privileged delivery boundary below. Verify that boundary before
enabling automated staging or production delivery; staging secrets and the Coolify
management plane also require protection. Current job cleanup does not provide it.

PR jobs require ephemeral, clean execution environments with no deployment secrets
or production network access. Use single-job registrations and recreate the VM or
equivalent isolation boundary; runner deregistration or workspace cleanup alone is
not enough. Never reuse a PR execution environment for privileged release work.
Deploy and provision through a separately controlled runner environment that runs
only trusted, reviewed workflows and cannot be selected by PR workflows. Enforce
access through supported runner restrictions and credential/network boundaries;
runner labels and path filters are not authorization. If that separation cannot
be enforced with the available GitHub plan, use clean hosted runners or an external
privileged executor rather than sharing a persistent PR runner.

The execution boundary is independent of staging/production resource placement.
A supported disposable VM boundary or clean hosted
PR executor may provide it; prove host-Docker, credential, and network isolation
before selecting an implementation. An ordinary container with the host Docker
socket cannot supply that boundary. The current persistent runner exposure above
remains unresolved by merely creating two Coolify environments.

Do not give build jobs the production Docker socket or cloud administrator keys.
Keep deploy jobs from executing untrusted code/artifacts, and isolate caches across
trust levels. Budget both execution roles. See
[GitHub self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use).

## Release contract and automated CD

Each deployable candidate records the source commit, CPU platform, image digest
for every custom service, non-secret runtime configuration revision, dataset and
migration requirements, verification results, and previous known-good release.
Retain this metadata and recoverable images beyond temporary CI artifact retention.
Never use `latest` as the production release identity.

### Build and publishing policy

| Event | Validation | Publish images | Deployment |
|---|---|---|---|
| Pull request | Required source/container checks | No | None |
| Eligible push/merge to `main` | Validate merged revision and candidate images | Commit-SHA tags after checks pass | Automatic staging, once bootstrap is complete |
| Documentation/test-only change | Relevant checks | No new application images solely for this change | None |
| Staging runtime configuration change | Assemble and verify a new complete candidate for this revision | Reuse verified images whose build inputs are unchanged | Staging configuration rollout |
| Operator dispatches `promote.yml` from `main` with published stable release `vX.Y.Z` | Verify selected commit's candidate and staging evidence using current promotion code | Optional version aliases for existing digests | Production promotion; no rebuild |

Keep the existing package names and lowercase the owner/repository path, as the
Moving publisher already does with `${GITHUB_REPOSITORY,,}`. Moving keeps
`ghcr.io/<lowercase-owner>/<lowercase-repo>/moving-{mcp,api,migrate}:<build-commit-sha>`;
do not create duplicate `mvp-moving-*` packages or break its existing handoff.
New integrated services use agreed service names under that same lowercase root,
for example `/web` and `/backend`. Standalone-agent images currently exist only
locally for CI; any future publishing needs agreed names under the same lowercase
root and a separate lifecycle. Each package has one publisher. Candidate
assembly consumes the existing Moving publisher's digest/provenance outputs or
integrates its build jobs deliberately, rather than introducing a competing writer.
Exporting those outputs as structured release metadata is implementation work.

### Complete candidates and unchanged services

`release.json` identifies a **candidate repository revision**, which need not be
the build commit of every image it references. The release coordinator maintains
an explicit inventory of all custom services and their build-input dependency
sets, and assembles every candidate as follows:

1. The first candidate builds/publishes every required image and records its
   digest, build commit, platform, and build-input fingerprint. With no complete
   verified baseline, a partial build cannot create a candidate.
2. Later candidates select a retained, verified ancestor manifest explicitly.
   Rebuild each affected service, including consumers of changed shared build
   inputs. Carry forward an unchanged service's exact digest only when its
   recorded build-input fingerprint and platform match the candidate inputs.
   Preserve its original build commit/provenance; do not invent a new SHA tag.
3. Merge newly published digests and eligible carried-forward digests into a
   complete inventory. Missing services, incompatible platforms, failed pushes,
   unknown dependencies, or unavailable base records fail candidate assembly.
4. Record this revision's shared runtime configuration, separate environment-input
   revisions, datasets, migrations, and selected image set. Deploy and verify the
   complete candidate with staging inputs. Staging evidence covers the images and
   shared configuration, not production-only values. Old staging evidence is not
   carried forward as evidence for a changed set or shared configuration. Archive
   a successful record tied to the candidate manifest hash; validate production
   inputs separately as described below.

A configuration-only candidate follows the same procedure while reusing the
entire eligible image set. Pure documentation/test-only commits do not emit a new
candidate by default. A stable release may target only a commit that has a complete
retained candidate and successful matching staging evidence. For a docs-only
merge, tag the eligible earlier candidate commit, not the latest docs commit.
If that exact later revision must be released, run an explicit candidate-validation
operation that assembles a complete set and obtains new staging evidence first.
Promotion never guesses a baseline, copies old evidence, or rebuilds missing images.

### Delivery flow

1. PR validation runs lint, unit tests, container startup tests, and integration
   tests. Untrusted code runs without deployment credentials.
2. On an eligible merge to `main`, the release workflow validates the merged
   revision, builds the required service images, tests them, and publishes them to GHCR. If
   testing requires a push, keep the image ineligible for deployment until tests pass.
3. Automatically configure the staging Coolify Service to use those digests and
   the selected non-secret configuration, then request deployment. Coolify does
   not rebuild source or run a parallel Git-push auto-deploy path.
4. Wait for the specific deployment to complete, confirm the intended release is
   running, and test readiness and a public smoke-test path. A successful webhook
   response means deployment was requested, not that the application is healthy.
5. A designated release operator publishes/selects a stable versioned GitHub release
   for an eligible candidate, then dispatches `promote.yml` **from current `main`**
   with that release tag. The workflow checks eligibility, deploys the same digest
   set to production, and verifies it; the same operation supports authorized retries.

### How production pins a tagged release

The Git tag `v1.0.0` selects a source commit. That commit selects its previously
published candidate manifest and staging verification evidence. The production
workflow must use the recorded digests, rather than rebuilding tagged source or
resolving whichever image currently has a moving tag.

```text
main commit → build/test → GHCR digests + release.json → verified staging
                                    ↑
published v1.0.0 → same commit → retained manifest → production digest pins
```

The final arrow requires an operator dispatch from current `main`; publishing
the release alone does not trigger it.

An abbreviated candidate manifest has this shape; actual manifests include every
custom service and the complete release/configuration evidence:

```json
{
  "sha": "<full-source-commit-sha>",
  "platform": "linux/arm64",
  "images": {
    "web": "ghcr.io/<lowercase-owner>/<lowercase-repo>/web@sha256:<web-digest>",
    "backend": "ghcr.io/<lowercase-owner>/<lowercase-repo>/backend@sha256:<backend-digest>"
  },
  "image_sources": {
    "web": "<web-build-commit-sha>",
    "backend": "<original-backend-build-commit-sha>"
  },
  "build_inputs": {
    "web": "sha256:<web-build-input-fingerprint>",
    "backend": "sha256:<unchanged-backend-build-input-fingerprint>"
  }
}
```

When a release is selected, the trusted selection operation records the release
ID, tag name, resolved full commit SHA, candidate manifest hash, and evidence
identifiers in a write-once release-selection record. Retain it in the controlled
release archive and attach a copy to the GitHub release. Retrying promotion must
reuse that record, not recreate it from the current tag. A changed selection needs
a new release identity; replacing a GitHub attachment cannot replace the archived
record.

Promotion resolves the Git tag again and compares it with that recorded commit.
Require the candidate manifest and successful staging evidence to match that
commit, all selected digests, and the shared configuration revision. Reject
missing/expired evidence, incomplete image sets, untested platforms, moved release
tags, drafts, and prereleases. Publishing a tag alone is not proof of a staging
pass. Retain the manifest and evidence durably alongside the selection record for
later redeploy and recovery.

The production definition uses references such as:

```yaml
services:
  web:
    image: ghcr.io/<lowercase-owner>/<lowercase-repo>/web@sha256:<verified-digest>
```

An optional image tag `:v1.0.0` names the same image for operators; the digest
remains the deployed identity. Subsequent `main` builds change staging, while
production stays on its recorded release until another explicit promotion.
See [Docker digest pinning](https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier).

### Shared configuration and environment-specific inputs

Staging verifies the selected images, shared Compose structure, variable
declarations, and shared application settings. Production has its own domains,
resource identifiers, credentials, and provider settings; these values do not
need to run in staging. Record shared configuration and each environment's inputs
as separate revisions in the release. Record secret references/version identifiers,
never secret values.

Before promotion, validate production inputs against the reviewed declarations,
required values, endpoint/resource ownership, and provider enablement policy. Save
and read back the selected Coolify configuration before starting deployment; compare
non-secret settings and verify secret presence/version through protected handling
without exposing values in records or logs. Record that validation and the
production-input revision in the production deployment record, linked to the
selected release. After deployment, verify the actual production release, routing,
readiness, and authorized smoke checks; only then mark promotion successful.
Promoting images does not authorize live provider transactions.

A production-only configuration change follows the same complete-candidate and
release-selection flow, reusing eligible image digests. Its staging run verifies
the images and unchanged shared configuration using staging inputs; production
validation/readback and post-deployment verification cover the changed production
inputs. An earlier image test alone cannot satisfy these checks.

### Runtime variables and Coolify-generated values

Keep runtime variable declarations in the reviewed Compose configuration and
secret values in the selected environment's secret storage. Use Coolify's
`SERVICE_<TYPE>_<ID>` generators selectively. For the `web` gateway, declare
`SERVICE_URL_WEB_8503: /` to route to its current internal port, `8503`
([gateway entrypoint](../../apps/browser-gateway/src/relohome_gateway/server.py)). A URL/FQDN generator's service
name and port suffix must match the deployed service and listening port; update
them together if that contract changes.

Preserve Moving's separate migration/admin and runtime roles from
[`compose.moving.yaml`](<../../deploy/moving/compose.moving.yaml>):

| Existing Compose input | Coolify-generated reference | Consumer mapping |
|---|---|---|
| `MOVING_DB_ADMIN_PASSWORD` | `${SERVICE_PASSWORD_64_MOVING_DB_ADMIN}` | `moving-db.POSTGRES_PASSWORD` and password in `moving-migrate.MOVING_DATABASE_ADMIN_URL` for `moving_admin` |
| `MOVING_DB_APP_PASSWORD` | `${SERVICE_PASSWORD_64_MOVING_DB_APP}` | `moving-migrate.MOVING_DB_APP_PASSWORD` and password in `MOVING_DATABASE_URL` for `moving_app`, supplied to `moving-api` and `moving-mcp` |

The rendered Coolify definition uses the corresponding generated reference in
each consumer field/URL. Preserve the database host/name from the selected
environment's configuration. The role names shown match the standalone Compose
stack; a shared PostgreSQL cluster requires distinct environment role names and
verified permission boundaries as specified in the handoff. Runtime apps receive
only the runtime URL, never
the admin password or admin URL. The migration job receives both credentials
because it establishes the runtime role. See the [Moving handoff](../runbooks/moving-coolify.md)
for environment database isolation. References reused within one Compose Service
resolve to the same value; each environment's Service retains its own values.

External provider credentials use ordinary required references such as
`${OPENAI_API_KEY:?}`; a real optional gateway setting is
`SIU_ALLOW_REGISTRATION: ${SIU_ALLOW_REGISTRATION:-true}`, matching the gateway's
current registration default. Set the intended policy explicitly per environment.
Existing saved values survive Compose reloads, so changing a default does not update an
existing value. Apply intentional value changes explicitly to the selected
environment. See [Coolify variable behavior](https://coolify.io/docs/applications/builds/docker-compose#environment-variables)
and [generated stack values](https://coolify.io/docs/applications/builds/docker-compose#generated-stack-values).

A shared runtime-variable declaration or setting change follows the complete-candidate
flow: validate the PR, prepare required staging values, deploy and verify staging,
then promote the
reviewed configuration with production's own values. A configuration-only change
reuses eligible image digests; a changed Dockerfile or value baked into an image
requires rebuilding affected images. Check required values before starting either
environment's rollout. Promote declarations and verification records without
copying staging secrets to production or retaining secret values in release metadata.
Environment-only value changes follow the separate input-revision and verification
rules above.

The renderer substitutes approved image references and non-secret configuration
while preserving variable/generator references for Coolify to resolve. Verify
this behavior through API readback and deployment tests. Local Compose supplies
local values or overrides instead of depending on Coolify generation. Preserve
stored credentials and encryption keys when recreating or migrating resources;
generator output must match the application's required format, and an existing
database's credentials require a coordinated rotation rather than regeneration.

### Promotion code and trigger

`promote.yml` uses `workflow_dispatch` with a stable release-tag input. Require
`github.ref == 'refs/heads/main'` before privileged steps, use the approved workflow
and adapter from that `main` revision, and record that revision separately from
the candidate commit. Resolve the input through the GitHub release/tag APIs and
verify the retained manifest, evidence, schema compatibility, and source identity.
Never execute workflow/scripts from the selected old tag to validate itself.

Publishing a GitHub release does not itself deploy production in this plan.
Manual dispatch is required even if the release was created by automation with
`GITHUB_TOKEN`; no downstream `release: published` event is assumed. GitHub
suppresses most workflow events generated with that token. Explicit dispatch
also allows a supported old candidate to be validated by current promotion code.
An unsupported old manifest is rejected for fresh validation, not silently accepted.
See [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/trigger-a-workflow).

Coolify documents building in GitHub Actions before triggering deployment. The
implementation must update the selected image references, not merely call a webhook
that still points at an older release. CI publishes with `GITHUB_TOKEN` and
`packages: write`. Authenticate private GHCR pulls on every deployment server as
the SSH user configured in Coolify; a personal classic PAT with `read:packages`
may be used when that account has package access and any required SSO authorization.
For server pulls, request only `read:packages`, without `repo`, package-write, or
package-delete scopes. Prefer an organization-managed service account limited to
the necessary packages where policy permits; record token ownership, expiry,
rotation, and revocation. A personal account with wider package access retains
that exposure even with a read-only token. Fine-grained PATs and Actions OIDC are
not substitutes for this server-side GHCR login under the currently documented
authentication support.
Use a supported Docker credential helper or access-controlled secret store; if
using a Docker config file as a fallback, restrict its parent directory and file
to the Coolify server user (0700/0600) and recognize that encoded credentials are
not encrypted. Never expose it in logs. Keeping the credential unreachable from PR
execution is a required boundary, not the current state: until #61 is fixed and
isolation verified, PR jobs with host Docker access can read the server's GHCR pull
credential and other host secrets despite file permissions or a separate
`DOCKER_CONFIG`. Treat the currently installed personal pull token as exposed to
those jobs; minimize its account/package access now and replace/rotate it after
isolation. Read-only scope still permits pulling any package the token's account
can access within that scope.
The publishing and pulling credentials are separate. CI uses its own temporary
`DOCKER_CONFIG`, so registry login/logout does not replace the server's persistent
pull credential. See [Coolify's CI integration](https://coolify.io/docs/applications/sources/github/actions)
and [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).
See [Docker credential storage](https://docs.docker.com/reference/cli/docker/login/#credential-stores)
for supported helpers and the config-file fallback.

The deployment adapter owns the approved Coolify settings described under
`deploy/coolify/`. These are our specifications, not a claim that Coolify natively
reconciles arbitrary YAML. Implement and test the adapter against the selected
Coolify version, using its [Service update API](https://coolify.io/docs/api/endpoints/services/update-service-by-uuid)
with base64-encoded Compose content and its [Service start API](https://coolify.io/docs/api/endpoints/services/start-service-by-uuid).
Save/read back the exact image references before starting; distinguish prepare-only
bootstrap from a full deployment. Service runtime statuses and release-identifying
public health must match the request; old healthy containers cannot pass a new
rollout. Verify migration outcomes using dependencies and available runtime evidence.
Verify digest encoding, API permissions, configuration updates, deployment status
polling, timeouts, and error handling before production. Record/reconcile deliberate
UI changes back into the specifications; bootstrap-only settings need a documented
recreation procedure. Keep API tokens and registry credentials out of Git and logs.

Serialize configuration update, deployment, and verification per environment.
Reject stale release requests. Do not cancel an active deployment or migration
just because a newer commit arrives. Store minimal credentials only in trusted
deployment contexts; separate them from ordinary test/build execution.

GitHub plan and organization permissions must be checked before relying on
protected environments, required reviewers, or restricted promotion permissions.
A manual workflow trigger is not a second-person approval by itself. If the
available plan cannot enforce the required privilege separation, use an external
credential/approval boundary or record the lack of a second-person promotion
approval explicitly. That limitation concerns operator approval only; it does not
permit untrusted PR jobs on the deployment host or weaken runner isolation.
See [GitHub deployment reviews](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments).

## Directory-scoped automation

The following routing rules are proposed, not a description of all current CI
filters. Apply a documentation exclusion **before** directory classification:
Markdown-only changes, including handoff docs under `deploy/` or `infra/`, never
authorize a rollout. Deployment rules select reviewed runtime configuration
through explicit file allowlists (initially YAML/JSON), not every file in a folder.
Only executable/build-input changes invoke the corresponding delivery helper rule.

| Inputs changed | Validation / delivery behavior |
|---|---|
| `apps/`, `packages/`, dependencies, Dockerfile, build inputs | Application checks; successful main release builds and deploys staging |
| Tests or Compose test configuration | Relevant tests; do not publish solely because tests changed |
| Approved YAML/JSON runtime inputs under `deploy/coolify/staging/` | Validate a complete candidate with known images and automatically apply staging configuration |
| Approved YAML/JSON runtime inputs under `deploy/coolify/prod/` | Validate; apply the approved configuration through production promotion |
| `infra/coolify/` | Validate/plan; apply only in a separately authorized infrastructure operation |
| `infra/runners/` | Validate runner configuration; update through controlled maintenance |
| Documentation only | Lightweight checks; no deployment |

Include workflow files and helper scripts in their relevant change rules. A change
affecting multiple areas runs all applicable checks. Shared application/runtime
configuration must first be tested in staging. Production-only inputs follow the
separate revision, pre-deployment validation/readback, and production verification
requirements above; staging evidence covers images and shared configuration.
An inactive Coolify destination/server must not deploy just because its files changed.

Use an always-triggered lightweight PR dispatcher and aggregate gate, with costly
jobs conditional on changed paths. Entire required workflows skipped by path filters
can leave checks pending. Path filters select work; they do not authorize it.
See [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

Build and staging deployment are linked explicitly by workflow dependencies, not
by assuming publishing an image generates a `deploy/` commit. Future bot-generated
promotion commits need deliberate authentication/event handling so required checks
actually run and configuration-only commits do not create image-build loops.

## Operations, recovery, and portability

- Provide real readiness checks, graceful shutdown, and release-identifying logs.
  Include request/workflow identifiers when implemented; never log secrets.
- Add versioned, backward-compatible database migrations as explicit release steps.
  Coordinate migrations and overlapping worker versions; stop duplicate consumers
  or schedulers where concurrent execution is unsafe.
- Back up application databases/files and Coolify control-plane configuration to
  storage outside the application host, including recoverable encryption material.
  Choose retention, recovery point/time objectives, and rehearse restores.
- Application recovery redeploys a compatible known-good image and configuration.
  It does not reverse database changes or external payments/bookings. Retain the
  previous release and implement failure alerts; do not blindly auto-revert data.
- Use standard database protocols and configurable object-storage endpoints.
  Keep data and secrets separate from deployment machinery. Preserve CPU
  architecture compatibility or publish/test the required multi-architecture images.
- Build only affected releases, cache safe build inputs, bound retention, and stop
  unnecessary staging workloads. Reducing containers does not reduce a fixed VM bill.

Coolify rolling replacement depends on health checks, shutdown, configuration, and
application compatibility; it is not a blanket zero-downtime guarantee. See
[rolling updates](https://coolify.io/docs/applications/deployments/rolling-updates).
Its [rollback feature](https://coolify.io/docs/applications/deployments/rollbacks)
also does not restore application data or previous runtime configuration for you.

## Implementation sequence and acceptance gates

| Step | Exit condition |
|---|---|
| Local/container foundation | Clean checkout starts locally; non-root container and integration tests pass |
| CI and runner setup | Clean PR environments and separately controlled privileged execution verified; directory routing and failure cleanup tested |
| Coolify staging | Eligible merge deploys correct image/configuration automatically; failed deployment fails CI |
| Environment operation | Deployment inputs identify the correct resources/destinations; capacity, limits, and recovery verified; where hosts are shared, staging/CI load preserves production release/data and meets the production latency objective |
| Production delivery | Stable release tag resolves to retained manifest/evidence; same tested digest set deploys without rebuilding, with production configuration verified |
| Recovery baseline | Backup restore and compatible application rollback demonstrated; deployment failure alerts work |
| Selected scaling/migration path | Destination-specific staging, recovery, cost, and cutover gates pass before production moves |

Before enabling delivery, finish capacity/budget, environment domains, secret
storage, runner isolation, operator permissions, data restore, recovery objectives,
and the measurable production latency objective.
Record consequential resolved choices in ADRs using the repository's guide.

## Scaling and migration choices

Resize or relocate a Coolify host, or qualify Coolify multi-server deployment
with external load balancing when needed. Keep local Compose, GitHub Actions,
GHCR, digest-pinned images, `release.json`, and promotion without rebuilding.
Follow the [Coolify scaling and migration plan](migration-options.md) for
selection, preparation, portability, and common cutover/recovery gates.
If Coolify multi-server is insufficient, Kubernetes requires its own ADR and plan.
