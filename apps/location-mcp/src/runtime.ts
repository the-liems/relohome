import {
  createDatabasePool,
  boundedQueries,
  getApplicationRuntimeConfig,
  HousingQueryService,
  LocationService,
  PlaceService,
  RouteService,
} from '@relohome/housing-query'
import { logger } from '@relohome/mcp-core'
import type { ReloHomeMcpDependencies } from './create-server.js'

export function createReloHomeMcpRuntime() {
  const config = getApplicationRuntimeConfig()
  const pool = createDatabasePool(config.databaseUrl)
  // pg-pool re-emits idle-client errors on the pool; without a listener they crash the process.
  pool.on('error', error => logger.error({ err: error }, 'location_mcp_pool_error'))
  const routeService = new RouteService(config.osrmUrls)
  const queries = boundedQueries(pool)

  const dependencies: ReloHomeMcpDependencies = {
    pool: queries,
    routeService,
    housingService: new HousingQueryService(queries, routeService, config),
    locationService: new LocationService(queries),
    placeService: new PlaceService(queries),
  }

  return { config, pool, dependencies }
}
