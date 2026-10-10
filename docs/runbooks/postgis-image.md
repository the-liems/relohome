# Publish ARM64 PostGIS images

The `PostGIS ARM64 image` workflow builds the upstream `postgis/docker-postgis`
`16-3.5/alpine` Dockerfile directly from Git and publishes it to
`ghcr.io/ai20k-build-phase-cohort-4/p-044/postgis` as `16-3.5-alpine`.
It is a source build on a native Linux ARM64 runner selected by
`[self-hosted, linux, ARM64, team-44]`, with `NPROC=2` limiting compilation.
The job verifies `uname -m` is `aarch64` before building. For queued publishes,
check ARM64 runner availability and labels using the
[self-hosted CI recovery instructions](self-hosted-ci.md#arm64-runner-availability-and-recovery).
PostgreSQL 16 uses Alpine because its upstream Debian recipe references an
unavailable Bullseye PGDG repository.

PRs changing the workflow build without publishing. Merging the workflow to `main`
builds and publishes; Actions → PostGIS ARM64 image → Run workflow → `main` also
publishes. This workflow adds no image, application, migration or restore tests.
Upstream's own Dockerfile build steps remain unchanged. Application integration
and migration validation belong to application CI.

`UPSTREAM_SHA` pins the upstream recipe. Update it through a PR when adopting an
upstream change. A recipe pin does not freeze its base image or package repository;
the resulting image digest identifies the actual artifact. Deploy that digest.
Git URL queries require Buildx 0.28+ and a compatible Dockerfile frontend.

Each publish moves the `16-3.5-alpine` tag to the new build, like upstream
`postgis/postgis` tags. The workflow summary and `postgis-image-*` artifact record
the tag, upstream SHA, platform and digest. Retain this information with application
release records and keep required images in GHCR; earlier builds stay there untagged,
so do not prune untagged versions that deployments still pin. Publishing uses
`GITHUB_TOKEN` and a temporary Docker configuration; cleanup removes only this job's
local image tags and login configuration.

The workflow does not change Coolify resources or application databases.
Mount the data volume at `/var/lib/postgresql/data` in the application stack.
