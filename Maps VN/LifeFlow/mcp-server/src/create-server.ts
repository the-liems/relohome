import { McpServer } from '@modelcontextprotocol/server'
import { registerHousingTools } from './tools/housing-tools.js'
import { registerLocationTools } from './tools/location-tools.js'
import { registerPlaceTools } from './tools/place-tools.js'
import { registerRoutingTools } from './tools/routing-tools.js'
import type { LifeFlowMcpDependencies } from './tools/types.js'

export type { LifeFlowMcpDependencies } from './tools/types.js'

export function createLifeFlowMcpServer(dependencies: LifeFlowMcpDependencies) {
  const server = new McpServer({
    name: 'lifeflow-location',
    version: '0.1.0',
  })

  registerHousingTools(server, dependencies)
  registerPlaceTools(server, dependencies)
  registerLocationTools(server, dependencies)
  registerRoutingTools(server, dependencies)

  return server
}
