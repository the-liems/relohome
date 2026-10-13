import {
  AhaMoveClient,
  createMovingDatabasePool,
  getMovingRuntimeConfig,
  MovingRepository,
  MovingService,
} from '@relohome/moving-service'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createMovingMcpServer } from './create-server.js'

const config = getMovingRuntimeConfig()
const db = createMovingDatabasePool(config.databaseUrl)
const movingService = new MovingService(AhaMoveClient.fromConfig(config), new MovingRepository(db), config)
const handle = serveStdio(() => createMovingMcpServer({ db, movingService, environment: config.environment }), {
  onerror(error) {
    console.error('LifeFlow Moving MCP transport error:', error instanceof Error ? error.message : 'unknown error')
  },
})

async function shutdown() {
  await handle.close()
  await db.end()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
