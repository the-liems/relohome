import {
  createDatabasePool,
  getRuntimeConfig,
  HousingQueryService,
  PlaceService,
  RouteService,
} from '@lifeflow/housing-query'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createLifeFlowMcpServer } from './create-server.js'

const config = getRuntimeConfig()
const pool = createDatabasePool(config.databaseUrl)
const routeService = new RouteService(config.osrmUrls)
const housingService = new HousingQueryService(pool, routeService, config)
const placeService = new PlaceService(pool)

const handle = serveStdio(
  () => createLifeFlowMcpServer({ pool, housingService, placeService, routeService }),
  {
    onerror(error) {
      console.error('LifeFlow MCP transport error:', error)
    },
  },
)

async function shutdown() {
  await handle.close()
  await pool.end()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
