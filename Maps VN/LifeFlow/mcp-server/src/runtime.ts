import {
  createDatabasePool,
  boundedQueries,
  getApplicationRuntimeConfig,
  HousingQueryService,
  LocationService,
  PlaceService,
  RouteService,
} from '@lifeflow/housing-query'
import type { LifeFlowMcpDependencies } from './create-server.js'

export function createLifeFlowMcpRuntime() {
  const config = getApplicationRuntimeConfig()
  const pool = createDatabasePool(config.databaseUrl)
  const routeService = new RouteService(config.osrmUrls)
  const queries = boundedQueries(pool)

  const dependencies: LifeFlowMcpDependencies = {
    pool: queries,
    routeService,
    housingService: new HousingQueryService(queries, routeService, config),
    locationService: new LocationService(queries),
    placeService: new PlaceService(queries),
  }

  return { config, pool, dependencies }
}
