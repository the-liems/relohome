import {
  HousingQueryService,
  LocationService,
  PlaceService,
  RouteService,
  type QueryExecutor,
} from '@relohome/housing-query'

export interface ReloHomeMcpDependencies {
  pool: QueryExecutor
  housingService: HousingQueryService
  locationService: LocationService
  placeService: PlaceService
  routeService: RouteService
}
