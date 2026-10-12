# ReloHome Housing and location HTTP API

Canonical package: `@relohome/platform-api`. From repository root:

```sh
npm ci
npm run build:ts
npm run dev:api
```

Configure the existing `Maps VN/LifeFlow/.env`, or set `LIFEFLOW_ENV_FILE`
explicitly. Root `npm run test:ts` runs portable checks;
`npm run test:ts:database` runs the location database suites with synthetic
imports in disposable PostGIS. Moving provider checks remain explicit opt-ins.

See the [relocation runbook](../../docs/runbooks/typescript-relocation.md) for
image builds, preserved identities, retained assets, and rollback.
