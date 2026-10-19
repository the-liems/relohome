# Staging and pull request deployments

For `the-liems/relohome`, keep staging at
`https://staging-v3.c4-app-044.io.vn` and PR previews at
`https://pr-<number>.c4-app-044.io.vn`.
Use separate Coolify Applications for staging and the preview parent, both
connected to `main` through the installed GitHub App. Each PR preview receives
its own containers and application-scoped volumes. The preview parent itself
does not need a running main deployment.

## Staging automation

Set `COOLIFY_STAGING_URL`, `COOLIFY_STAGING_APP_UUID`, and the
`COOLIFY_STAGING_TOKEN` secret, then set `STAGING_AUTO_DEPLOY=true` after the
initial rollout is verified. The deploy workflow waits for successful main CI,
pins the exact commit, and checks that its images exist before queuing Coolify.
Disable Coolify push auto deployment so GitHub App webhooks cannot race image
publication. Manual workflow dispatch remains available.

## Preview parent

Load `/compose.coolify.yaml`, expose only `web` on target port **8503**, and set
the preview URL template to `pr-{{pr_id}}.c4-app-044.io.vn`. Keep Coolify's native
PR preview webhook trigger disabled: in Coolify v4.4.6 it is independent of push
auto deployment and would deploy before Actions publishes the PR images. The
preview API used by Actions works with that native webhook trigger disabled.
Enable source commit availability during build and disable label escaping.

Configure **Preview Deployment Environment Variables** with the required inputs
listed in [the deployment guide](README.md). Give previews fresh internal service
tokens, database passwords, and a webhook secret. Use sandbox provider settings;
trusted same-repository PR code can read preview runtime credentials. Keep
`APP_URL` empty so Compose uses the preview-specific `SERVICE_URL_WEB` generated
by Coolify. Do not copy staging volumes or production user allowlists.

For the new repository, set these image overrides in both Actions variables and
the preview environment:

```text
APPLICATION_IMAGE_REPOSITORY=ghcr.io/the-liems/relohome
POSTGIS_IMAGE=ghcr.io/the-liems/relohome/postgis:16-3.5-alpine
```

Leaving the overrides unset preserves the legacy registry paths. The existing
staging and production Applications do not need configuration changes.

## Actions settings and lifecycle

| Setting | Type | Value |
| --- | --- | --- |
| `COOLIFY_PREVIEW_URL` | Variable | `https://coolify.c4-app-044.io.vn` |
| `COOLIFY_PREVIEW_APP_UUID` | Variable | Dedicated preview parent UUID |
| `COOLIFY_PREVIEW_TOKEN` | Secret | Coolify token with read, write, and deploy permissions |
| `COOLIFY_PREVIEWS_ENABLED` | Variable | `true` after parent configuration is complete |

Coolify currently scopes these API permissions to the team; rotate expiring
tokens and remember that they can control other team Applications. Source clone
access through the GitHub App and server-side GHCR pull access are separate.

The preview workflow builds and publishes all application images for an open,
non-draft, same-repository PR targeting `main`. Before deployment it rechecks
that the PR is still open at the built SHA. Fork PRs are excluded. Deployment
uses trusted tooling from the base commit and verifies the resulting commit and
running status.

Closing or merging the PR runs the cleanup workflow, which removes that PR's
preview and its disposable volumes. Cleanup uses the configured parent UUID
even when `COOLIFY_PREVIEWS_ENABLED=false`, so pausing new previews does not
strand existing ones. Preview and cleanup jobs share a concurrency group.

## Rollout failures

A CI polling timeout does not mean the server stopped deploying. Inspect the
existing deployment UUID in Coolify before dispatching another rollout. The
client retries transient GET socket/gateway timeouts a bounded number of times;
it never automatically repeats POST or PATCH requests, since the server might
already have accepted them.

Before enabling more previews, verify host capacity for an additional full stack
and exercise one PR deployment, synchronization, and closure. Do not remove
legacy preview volumes to recover capacity without the owner's approval.
