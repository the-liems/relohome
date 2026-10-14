# Build with the repository root as context; runtime paths remain unchanged.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY ["tsconfig.base.json", "./"]
COPY scripts/docker-npm.mjs /tmp/docker-npm.mjs
COPY ["packages/telemetry/", "packages/telemetry/"]
COPY ["packages/contracts/package.json", "packages/contracts/package.json"]
COPY ["packages/housing-query/package.json", "packages/housing-query/package.json"]
COPY ["packages/mcp-core/package.json", "packages/mcp-core/package.json"]
COPY ["apps/location-mcp/package.json", "mcp-server/package.json"]

RUN node /tmp/docker-npm.mjs --image-build
RUN npm ci --workspace @relohome/telemetry --workspace @relohome/contracts --workspace @relohome/housing-query --workspace @relohome/mcp-core \
    --workspace @relohome/location-mcp --include-workspace-root=false

COPY ["packages/contracts", "packages/contracts"]
COPY ["packages/housing-query", "packages/housing-query"]
COPY ["packages/mcp-core", "packages/mcp-core"]
COPY ["apps/location-mcp", "mcp-server"]

RUN node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; for (const app of ["mcp-server"]) { const path=app+"/tsconfig.json"; const config=JSON.parse(readFileSync(path)); config.extends="../tsconfig.base.json"; writeFileSync(path,JSON.stringify(config)); }'

RUN npm run build --workspace @relohome/telemetry \
 && npm run build --workspace @relohome/contracts \
 && npm run build --workspace @relohome/housing-query \
 && npm run build --workspace @relohome/mcp-core \
 && npm run build --workspace @relohome/location-mcp \
 && npm prune --omit=dev --workspace @relohome/telemetry --workspace @relohome/contracts --workspace @relohome/housing-query --workspace @relohome/mcp-core \
    --workspace @relohome/location-mcp --include-workspace-root=false

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=build --chown=node:node /app/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/housing-query/package.json ./packages/housing-query/package.json
COPY --from=build --chown=node:node /app/packages/housing-query/dist ./packages/housing-query/dist
COPY --from=build --chown=node:node /app/packages/mcp-core/package.json ./packages/mcp-core/package.json
COPY --from=build --chown=node:node /app/packages/mcp-core/dist ./packages/mcp-core/dist
COPY --from=build --chown=node:node /app/mcp-server/package.json ./mcp-server/package.json
COPY --from=build --chown=node:node /app/mcp-server/dist ./mcp-server/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.MCP_PORT + '/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "--import", "@relohome/telemetry/register", "mcp-server/dist/http-server.js"]
