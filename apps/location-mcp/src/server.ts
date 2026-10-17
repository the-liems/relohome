import { logger } from '@relohome/mcp-core'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createReloHomeMcpServer } from './create-server.js'
import { createReloHomeMcpRuntime } from './runtime.js'

const { pool, dependencies } = createReloHomeMcpRuntime()

const handle = serveStdio(
  () => createReloHomeMcpServer(dependencies),
  {
    onerror(error) {
      logger.error({ err: error }, 'location_mcp_transport_error')
    },
  },
)

async function shutdown() {
  await handle.close()
  await pool.end()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
