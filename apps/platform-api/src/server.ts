import { createDatabasePool, getApplicationRuntimeConfig } from '@relohome/housing-query'
import { buildApp } from './app.js'

const config = getApplicationRuntimeConfig()
const pool = createDatabasePool(config.databaseUrl)
const app = buildApp(pool, config)
// pg-pool re-emits idle-client errors on the pool; without a listener they crash the process.
pool.on('error', error => app.log.error({ err: error }, 'database pool error'))

const host = process.env.PLATFORM_API_HOST || '127.0.0.1'
const port = Number(process.env.PLATFORM_API_PORT || 4100)

await app.listen({ host, port })

const shutdown = () => void app.close().catch(() => { process.exitCode = 1 })
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
