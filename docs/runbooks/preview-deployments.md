# Pull request previews

Each same-repository, non-draft PR targeting `main` gets its own application
stack and Collector. The public URL is `https://pr-<number>.c4-app-044.io.vn`.
All services join Coolify's automatically generated resource network for that
preview. Only `collector` additionally joins the existing shared ingestion
network, `relohome-observability-ingest`. Tempo, Loki and Cortex remain shared.
The Collector has no published port or public domain.

## Prepare Coolify

1. Merge this implementation before enabling the workflows. Create a dedicated
   Git-based Application in **Development**, on the same Docker host as the
   observability stack. Use the repository access and ARM64 destination described
   in [deployment setup](../../deploy/README.md). Select branch `main`, base
   directory `/`, Docker Compose build pack, and `/compose.coolify.yaml`.
2. Enable **Preserve repository during deployment** so the Collector's relative
   configuration mount exists. Enable preview deployments. Configure the preview
   domain template to produce `pr-<PR number>.c4-app-044.io.vn`; route `web` to
   port **8503**. Ensure wildcard DNS points `*.c4-app-044.io.vn` at this server
   and HTTPS certificates can be issued for those hosts. Do not assign domains
   to the Collector or internal services.
3. Populate the Application's **preview** environment variables with development
   credentials and the required inputs from [deployment setup](../../deploy/README.md).
   Set preview `OTEL_DEPLOYMENT_ENVIRONMENT=preview` and `APP_ENV=staging`.
   Public origins are derived from Coolify’s `SERVICE_URL_WEB`. Keep payment credentials in
   sandbox mode and data-download credentials read-only. Configure Langfuse's
   existing HTTPS endpoint and development project keys if direct agent tracing
   is enabled. No separate OTLP endpoint or authentication header is needed.
4. Set `OBSERVABILITY_INGEST_NETWORK` if the existing network has a different
   name. It must already exist and provide the aliases `tempo`, `loki`, and
   `cortex`. Keep Coolify's **Connect to predefined network** option disabled;
   Compose explicitly declares the one shared network the Collector needs.
5. Disable automatic Coolify Git/webhook deployment for this resource; GitHub
   Actions starts previews only after the complete image build and image checks.
   Enable **Include Source Commit in Build** so `SOURCE_COMMIT` is available,
   and disable container-label escaping as for the existing deployment.
   Do not use this resource for staging or production deployments.

Coolify supplies `SOURCE_COMMIT`, `SERVICE_NAME_*`, `SERVICE_URL_WEB`, and
`SERVICE_FQDN_WEB`. Do not override them with staging values. The generated
service names allow internal URLs to follow Coolify's PR service-name suffixes.
No `COOLIFY_PR_ID` environment variable is assumed: the Collector derives the PR
number from the configured web hostname (`pr-<number>.<domain>`); the domain
suffix is not hardcoded. If the hostname does not match, telemetry still exports
without `preview.id`, so it will not appear under a PR in the dashboard.

## Enable CI and observability

Deploy the updated shared observability configuration first. It adds `preview.id`
to Loki and Cortex resource promotion and provisions **ReloHome PR previews** in
Grafana. Operational alerts select staging and production only.

Configure these GitHub repository settings:

| Setting | Value |
| --- | --- |
| Variable `COOLIFY_PREVIEW_URL` | `https://coolify.c4-app-044.io.vn` |
| Variable `COOLIFY_PREVIEW_APP_UUID` | Dedicated Development Application UUID |
| Secret `COOLIFY_PREVIEW_TOKEN` | Coolify API token authorized to deploy and delete previews |
| Variable `COOLIFY_PREVIEWS_ENABLED` | `true`, after configuration is ready |

The workflow builds all application images at the PR head SHA, verifies those
images, and requests a preview at that exact commit. It checks deployment commit
and preview status before reporting success. Both `running:healthy` and
`running:unknown` (running without a healthcheck) are accepted; unhealthy,
degraded and stopped states are not. The upstream Collector image is used
without a Docker healthcheck. Normal CI runs separately; this
workflow does not wait for every normal CI test. Fork PRs and drafts are excluded.
Use repository collaborators' trusted PRs because application code runs with
the preview credentials on the deployment server.

Closing or merging a PR deletes its Coolify preview, including its local volumes.
Cleanup still runs when new previews are disabled. Exported telemetry remains in
the shared stores under their retention policies; local queued telemetry is lost
when its Collector volume is removed.

## Verify the first preview

Before enabling routine use, inspect Coolify's rendered Compose and the running
containers for a test PR:

- `web`, `backend`, databases and other application services join only that PR's
  resource network (plus any proxy connectivity Coolify requires for routing).
- `collector` joins that resource network and the existing ingestion network.
  Other application services must not join ingestion. Check actual network
  membership with `docker inspect` on the deployment host.
- The Collector resolves `tempo`, `loki`, and `cortex`; application services can
  resolve the generated Collector service name and reach its private port 4318.
- Open the preview URL, perform a request, and select its PR number in the
  **ReloHome PR previews** dashboard. Inspect a Tempo trace and Loki log too.
- Close the test PR and verify its containers and volumes disappear while the
  shared ingestion network and observability backends remain available.

The network design was checked against Coolify v4.4.6's Compose parser. Explicit
network membership is retained and the per-preview resource network is added
automatically. Recheck rendered membership after Coolify upgrades.

## Attributes

| Resource attribute | Example |
| --- | --- |
| `deployment.environment.name` | `preview` |
| `service.namespace` | `relohome` |
| `service.name` | Original emitting service name |
| `service.version` | Full PR head commit SHA |
| `preview.id` | `200` |
| `preview.hostname` | `pr-200.c4-app-044.io.vn` |

The Collector stamps traces, logs, metrics and its own internal metrics. There is
no additional `environment` attribute. Loki/Cortex expose promoted attributes as
`deployment_environment_name` and `preview_id`. Langfuse traffic bypasses the
Collector: its SDK uses environment `preview`, release SHA, and the LangGraph
run carries PR identity as metadata.

## Maintain and test

Edit `compose.coolify.yaml` and `deploy/observability/collector.yaml` directly.
Staging, production and PR previews all use these same files:

```sh
pytest tests/test_preview_configuration.py tests/test_coolify_deployment.py tests/test_ci_images.py
RUN_PREVIEW_COLLECTOR_TEST=1 pytest tests/test_preview_collector_runtime.py
```

The opt-in Docker test sends synthetic OTLP traces, logs and metrics through the
actual Collector image for preview, staging and production. It verifies PR
attributes are present only in previews and that Tempo redaction still applies. It does not
contact or validate the live observability backends.

For the direct staging/production cutover, see [Collector migration](observability.md#replace-standalone-collectors).
