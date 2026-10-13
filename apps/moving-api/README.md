# ReloHome Moving HTTP API

Canonical package: `@relohome/moving-api`. From repository root:

```sh
npm ci
npm run build:ts
npm run dev:moving-api
```

Configure the repository-root `.env.local` (`npm run dev:init` creates it); the
npm scripts pass it with `--env-file`. Root `npm run test:ts` runs portable checks;
`npm run test:ts:database` runs the location database suites with synthetic
imports in disposable PostGIS. Moving provider checks remain explicit opt-ins.

See the [relocation runbook](../../docs/runbooks/typescript-relocation.md) for
image builds, preserved identities, retained assets, and rollback.
