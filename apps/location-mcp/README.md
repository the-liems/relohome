# ReloHome Location MCP over stdio or HTTP

Canonical package: `@relohome/location-mcp`. From repository root:

```sh
npm ci
npm run build:ts
npm run dev:mcp:http
```

Configure the repository-root `.env.local` (`npm run dev:init` creates it); the
npm scripts pass it with `--env-file`. Root `npm run test:ts` runs portable checks;
`npm run test:ts:database` runs the location database suites with synthetic
imports in disposable PostGIS. Moving provider checks remain explicit opt-ins.

See the [relocation runbook](../../docs/runbooks/typescript-relocation.md) for
image builds, preserved identities, retained assets, and rollback.

## Administrative area scope

`search_areas` accepts the optional `within_area_id` of an already resolved city
or administrative area. The service applies polygon membership (the candidate's
representative point, as used for its returned parent) **before ranking and LIMIT**.
A missing scope ID returns no candidates. An optional `bounding_box` is applied
together with this filter; it does not establish membership by itself.

For example, resolve Hồ Chí Minh first, then search `Bình Thạnh` with that returned
city ID. A rectangular city extent can contain parts of neighbouring provinces,
so bbox-only searches can return unrelated names before the correct ward.

Older callers may omit this parameter. Deploy/build the updated contracts,
housing-query and Location MCP together with the Agent API to enable scoped
lookups. No database migration or new environment variable is required.
