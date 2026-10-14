# syntax=docker/dockerfile:1.14
# Build with the repository root as context; runtime paths remain unchanged.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY ["tsconfig.base.json", "./"]
COPY scripts/docker-npm.mjs /tmp/docker-npm.mjs
COPY ["packages/telemetry/", "packages/telemetry/"]
COPY ["packages/contracts/package.json", "packages/contracts/package.json"]
COPY ["packages/housing-query/package.json", "packages/housing-query/package.json"]
COPY ["apps/platform-api/package.json", "platform-api/package.json"]

RUN node /tmp/docker-npm.mjs --image-build
RUN npm ci --workspace @relohome/telemetry --workspace @relohome/contracts --workspace @relohome/housing-query \
    --workspace @relohome/platform-api --include-workspace-root=false

COPY ["packages/contracts", "packages/contracts"]
COPY ["packages/housing-query", "packages/housing-query"]
COPY ["apps/platform-api", "platform-api"]

RUN node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; for (const app of ["platform-api"]) { const path=app+"/tsconfig.json"; const config=JSON.parse(readFileSync(path)); config.extends="../tsconfig.base.json"; writeFileSync(path,JSON.stringify(config)); }'

RUN npm run build --workspace @relohome/telemetry \
 && npm run build --workspace @relohome/contracts \
 && npm run build --workspace @relohome/housing-query \
 && npm run build --workspace @relohome/platform-api \
 && npm prune --omit=dev --workspace @relohome/telemetry --workspace @relohome/contracts --workspace @relohome/housing-query \
    --workspace @relohome/platform-api --include-workspace-root=false

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLATFORM_API_HOST=0.0.0.0 \
    PLATFORM_API_PORT=4100

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=build --chown=node:node /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/housing-query/package.json ./packages/housing-query/package.json
COPY --from=build --chown=node:node /app/packages/housing-query/dist ./packages/housing-query/dist
COPY --from=build --chown=node:node /app/platform-api/package.json ./platform-api/package.json
COPY --from=build --chown=node:node /app/platform-api/dist ./platform-api/dist

USER node

FROM runtime AS location-migrate
COPY --chmod=u=rwX,go=rX ["deploy/database/migrations/", "./database/migrations/"]
CMD ["node", "platform-api/dist/migrate.js"]

FROM runtime AS platform
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PLATFORM_API_PORT + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "@relohome/telemetry/register", "platform-api/dist/server.js"]
