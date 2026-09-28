import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createLifeFlowMcpServer } from './create-server.js'
import { createLifeFlowMcpRuntime } from './runtime.js'

const { pool, dependencies } = createLifeFlowMcpRuntime()

const handle = serveStdio(
  () => createLifeFlowMcpServer(dependencies),
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
