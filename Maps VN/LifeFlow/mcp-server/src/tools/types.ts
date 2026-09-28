import {
  HousingQueryService,
  LocationService,
  PlaceService,
  RouteService,
  type QueryExecutor,
} from '@lifeflow/housing-query'

export interface LifeFlowMcpDependencies {
  pool: QueryExecutor
  housingService: HousingQueryService
  locationService: LocationService
  placeService: PlaceService
  routeService: RouteService
}
