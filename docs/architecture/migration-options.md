# Coolify scaling and migration options

Status: planned alternatives; no target selected or provisioned.
Deployment mechanism superseded by [deploy/README.md](../../deploy/README.md).
Scope and Coolify capabilities reviewed: 2026-10-06. Recheck versions, support,
quotas, and regional pricing before implementation.

Start with the [Coolify-first plan](infrastructure.md). Future destinations are
alternatives, not a mandatory sequence. Stay on the current platform while it
meets the project's needs. Staging/production resource placement is a deployment
input; these alternatives do not impose a fixed server topology on the CD plan.
The release contract remains portable while this plan covers the Coolify paths
we can evaluate against concrete capacity and reliability requirements.

## Choose a destination

| Path | Choose when | Main work and responsibility |
|---|---|---|
| A. Larger or replacement Coolify host | Capacity, location, or provider must change without changing the deployment model | Host setup, state transfer, endpoint changes; team operates hosts and Coolify |
| B. Coolify multi-server | Stateless application replicas and host-failure tolerance are sufficient | Shared state, external load balancing, per-server release checks; team operates the fleet |

Select one target per migration. Record the reason, owner, topology, monthly cost
ceiling, recovery objectives, and accepted limitations in an ADR. Use GitHub Issues
and a milestone for implementation and evidence; do not maintain a second task
tracker in this document. Multi-cloud active-active is outside this plan.

## Common portability contract

- Keep local Compose, application source, tests, immutable OCI images pinned by
  digest, and retained `release.json` records. Promote verified releases without
  rebuilding.
  Preserve source-to-image provenance. Match CPU architecture or test each target
  architecture; an untested platform image is not the same verified release.
- Configure endpoints and secrets at runtime. Keep provider SDK integrations behind
  explicit adapters. Object-storage authentication and API behavior are not identical
  across providers; an endpoint variable alone is not sufficient portability.
- Keep durable state outside application containers. Inventory databases, extensions,
  uploads, queues, sessions, workflow checkpoints, approval records, and idempotency
  keys. Do not add unused services solely for future portability.
- Use application-aware backups and rehearsed restores. A host volume or cloud disk
  snapshot is not a cross-provider data transfer format.
- Preserve readiness, graceful termination, release identity, structured logs, and
  external smoke tests. Test streaming connections and long-running workflows.
- Keep runners independent during the first move. Changing the deployment platform
  does not require migrating CI runners or replacing GitHub Actions/GHCR.
- Retain GHCR initially; mirror images only for a measured access, reliability, or
  cost reason. Verify destination digests/provenance and pull access before cutover.
- Prefer narrowly scoped, short-lived cloud credentials where supported. CI cloud
  identity, workload cloud identity, Git access, and registry access are separate.

## Planned configuration boundaries

Create only the selected path's directories when implementation starts. All stay
in this repository on `main`; changes use reviewed short-lived branches.

The [canonical planned repository structure](infrastructure.md#planned-repository-structure)
owns deployment paths and their lifecycle boundaries. Keep environment runtime
configuration in `compose.coolify.yaml` and host/bootstrap/network inventory under
`infra/coolify/<installation>/`. Record each environment's resource and destination
identifiers as deployment inputs; source and destination may coexist during a move.

Where infrastructure provisioning uses state, keep source and destination state
separate in encrypted, access-controlled storage with locking and backups. Keep
credentials and sensitive state outside Git. Assign explicit ownership of proxy,
load balancer, network, storage, and database changes alongside application releases.

## Path A: move or resize Coolify

1. Measure the bottleneck and confirm whether resizing is enough. Schedule any
   provider-required interruption and verify backups before changing the host.
2. For relocation, prepare a new supported Linux host, add/validate it in Coolify,
   configure restricted SSH/network access, and verify private registry pulls.
   Treat moving the Coolify management instance itself as a separate backup/restore
   exercise, including its encryption material and credentials.
3. Recreate application settings from the recorded release/configuration and restore
   representative data. Verify domains, volumes, health checks, and external access.
4. Follow the common cutover gates below. Retain the old host until acceptance.

The host may be on any suitable IaaS provider; changing providers
does not itself require changing the application platform. Validate Docker/OS,
architecture, network reachability, and data-transfer costs for the actual host.
See [Coolify server setup](https://coolify.io/docs/core/infrastructure/servers/add-server).

## Path B: Coolify multi-server

Current Coolify multi-server support excludes Docker Compose applications and
applications with persistent storage configured. Use independent, stateless
application resources and shared data services; do not duplicate local state across
hosts. Servers need matching CPU architecture and registry access. See
[multi-server requirements](https://coolify.io/docs/core/infrastructure/scaling/multi-server-deployments).

The integrated application's Docker Compose Empty Service is not a fleet deployment
definition. Selecting this path requires separating eligible stateless application
resources and moving their local state to shared services first; adding another
server does not replicate the Compose stack, its volumes, or its routing datasets.

1. First make the application safe for concurrent instances. Move any necessary
   local state to shared services through a rehearsed data migration. Keep singleton
   schedulers single-owned; test worker concurrency and idempotency separately.
2. Add and validate a second standalone application server. On the pinned Coolify
   version, prove that our CI-built digest deploys unchanged to every destination;
   do not assume the source-build example in the docs proves this exact workflow.
3. Provision an external load balancer, private connectivity, firewall rules, DNS,
   TLS, and readiness checks. Manage its target membership explicitly alongside the
   Coolify server inventory; attaching a Coolify server does not update the LB.
4. Prefer routing through each server's Coolify proxy when preserving application
   rolling updates. Preserve the Host header, including health checks. Direct host
   port mappings disable rolling updates; if selected, rehearse drain/deploy/rejoin
   one backend at a time and retain enough healthy capacity.
5. Extend CD verification to every intended backend and the public endpoint. Test
   a failed deployment, a failed host, mixed-version compatibility, and recovery.
   Do not assume application-wide deployment is a safe serial fleet rollout.

Gate: the tested release runs on every backend; traffic survives a backend failure;
sessions/workflows remain correct; data and management-plane recovery are rehearsed.
Multiple app hosts alone do not make the database or Coolify management instance HA.
Follow the common cutover gates when relocating data or changing the public endpoint. See
[load-balancer ownership and routing](https://coolify.io/docs/core/infrastructure/scaling/cloud-load-balancing).

## Shared execution and acceptance gates

1. **Select:** record requirements, target/mode, owners, monthly and migration budget,
   recovery point/time objectives, maintenance window, and rollback criteria.
2. **Prepare:** inventory release/configuration and data; export backups; establish
   destination identity/network/registry access; keep source recovery available.
3. **Rehearse:** deploy isolated staging with representative restored data. Verify
   automatic staging CD, explicit production promotion, logs, performance, failure
   behavior, and restore. Do not use live irreversible external actions in tests.
4. **Cut over:** freeze releases; pause writes and drain workers as needed; transfer
   final state consistently; verify it; switch routing; enable only the selected
   writers/schedulers and delivery controller. Account for DNS caches and connections.
5. **Observe/recover:** verify release identity, public health, error/latency and queue
   metrics, data integrity, and cost. Before new writes, routing rollback may suffice
   if data remains compatible. After new writes, reconcile/reverse-transfer state or
   roll forward; never simply reconnect an outdated database.
6. **Retire:** after explicit acceptance, remove old billable resources, rotate unused
   credentials, and retain required backups/evidence. Do not destroy the source merely
   because the first deployment succeeded.

Default to a controlled maintenance window. Online replication, dual writes, or
active-active require a separate tested design.

Estimate steady-state cost and temporary overlap separately, using the selected
region and actual workload. Include runners, management plane, database HA, backups,
egress, observability, and engineering/on-call effort. Define capacity limits and
alerts; neither replica reduction nor budget alerts guarantee a capped cloud bill.
