import { createDatabasePool, getApplicationRuntimeConfig } from '@relohome/housing-query'
import { buildApp } from './app.js'

const config = getApplicationRuntimeConfig()
const pool = createDatabasePool(config.databaseUrl)
const app = buildApp(pool, config)

const host = process.env.PLATFORM_API_HOST || '127.0.0.1'
const port = Number(process.env.PLATFORM_API_PORT || 4100)

await app.listen({ host, port })
