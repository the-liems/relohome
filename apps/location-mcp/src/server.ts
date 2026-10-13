import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createReloHomeMcpServer } from './create-server.js'
import { createReloHomeMcpRuntime } from './runtime.js'

const { pool, dependencies } = createReloHomeMcpRuntime()

const handle = serveStdio(
  () => createReloHomeMcpServer(dependencies),
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
