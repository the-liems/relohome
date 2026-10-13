import {
  AhaMoveClient,
  createMovingDatabasePool,
  getMovingRuntimeConfig,
  MovingRepository,
  MovingService,
} from '@relohome/moving-service'
import { buildMovingApp } from './app.js'

const config = getMovingRuntimeConfig()
const db = createMovingDatabasePool(config.databaseUrl)
const service = new MovingService(AhaMoveClient.fromConfig(config), new MovingRepository(db), config)
const app = buildMovingApp(db, service, config)
const port = Number(process.env.MOVING_API_PORT || 4200)
const host = process.env.MOVING_API_HOST || '127.0.0.1'

await app.listen({ host, port })

const shutdown = () => void app.close().catch(() => { process.exitCode = 1 })
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
