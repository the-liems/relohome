# syntax=docker/dockerfile:1.14
# Build with the repository root as context; runtime paths remain unchanged.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY ["Maps VN/LifeFlow/tsconfig.base.json", "./"]
COPY scripts/docker-npm.mjs /tmp/docker-npm.mjs
COPY ["Maps VN/LifeFlow/packages/contracts/package.json", "packages/contracts/package.json"]
COPY ["Maps VN/LifeFlow/packages/housing-query/package.json", "packages/housing-query/package.json"]
COPY ["Maps VN/LifeFlow/platform-api/package.json", "platform-api/package.json"]

RUN node /tmp/docker-npm.mjs --image-build
RUN npm ci --workspace @lifeflow/contracts --workspace @lifeflow/housing-query \
    --workspace @lifeflow/platform-api --include-workspace-root=false

COPY ["Maps VN/LifeFlow/packages/contracts", "packages/contracts"]
COPY ["Maps VN/LifeFlow/packages/housing-query", "packages/housing-query"]
COPY ["Maps VN/LifeFlow/platform-api", "platform-api"]

RUN npm run build --workspace @lifeflow/contracts \
 && npm run build --workspace @lifeflow/housing-query \
 && npm run build --workspace @lifeflow/platform-api \
 && npm prune --omit=dev --workspace @lifeflow/contracts --workspace @lifeflow/housing-query \
    --workspace @lifeflow/platform-api --include-workspace-root=false

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLATFORM_API_HOST=0.0.0.0 \
    PLATFORM_API_PORT=4100

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/housing-query/package.json ./packages/housing-query/package.json
COPY --from=build --chown=node:node /app/packages/housing-query/dist ./packages/housing-query/dist
COPY --from=build --chown=node:node /app/platform-api/package.json ./platform-api/package.json
COPY --from=build --chown=node:node /app/platform-api/dist ./platform-api/dist

USER node

FROM runtime AS location-migrate
COPY --chmod=u=rwX,go=rX ["Maps VN/LifeFlow/database/migrations/", "./database/migrations/"]
CMD ["node", "platform-api/dist/migrate.js"]

FROM runtime AS platform
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PLATFORM_API_PORT + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "platform-api/dist/server.js"]
