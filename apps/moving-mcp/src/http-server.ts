import { AhaMoveClient, createMovingDatabasePool, getMovingRuntimeConfig,
  MovingRepository, MovingService } from '@relohome/moving-service'
import { logger } from '@relohome/mcp-core'
import { buildMovingHttpServer, getMovingHttpOptions } from './http-app.js'

const config = getMovingRuntimeConfig()
const options = getMovingHttpOptions()
const db = createMovingDatabasePool(config.databaseUrl)
const movingService = new MovingService(AhaMoveClient.fromConfig(config), new MovingRepository(db), config)
const app = buildMovingHttpServer({ db, movingService, environment: config.environment }, options)
const host = process.env.MOVING_MCP_HOST || '127.0.0.1'
const port = Number(process.env.MOVING_MCP_PORT || 4400)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MOVING_MCP_PORT.')
app.server.listen(port, host, () => logger.info({ host, port, release: options.release }, 'moving_mcp_listening'))
const shutdown = () => void app.close().catch(() => { process.exitCode = 1 })
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
