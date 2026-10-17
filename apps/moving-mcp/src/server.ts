import {
  AhaMoveClient,
  createMovingDatabasePool,
  getMovingRuntimeConfig,
  MovingRepository,
  MovingService,
} from '@relohome/moving-service'
import { logger } from '@relohome/mcp-core'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createMovingMcpServer } from './create-server.js'

const config = getMovingRuntimeConfig()
const db = createMovingDatabasePool(config.databaseUrl)
const movingService = new MovingService(AhaMoveClient.fromConfig(config), new MovingRepository(db), config)
const handle = serveStdio(() => createMovingMcpServer({ db, movingService, environment: config.environment }), {
  onerror(error) {
    logger.error({ err: error }, 'moving_mcp_transport_error')
  },
})

async function shutdown() {
  await handle.close()
  await db.end()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
