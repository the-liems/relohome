import {
  createDatabasePool,
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

  const dependencies: LifeFlowMcpDependencies = {
    pool,
    routeService,
    housingService: new HousingQueryService(pool, routeService, config),
    locationService: new LocationService(pool),
    placeService: new PlaceService(pool),
  }

  return { config, pool, dependencies }
}
