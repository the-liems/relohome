import {
  RouteRequestSchema,
  RouteResultSchema,
  type Coordinate,
  type RouteRequest,
  type RouteResult,
} from '@lifeflow/contracts'
import type { RuntimeConfig } from './config.js'
import { RouteServiceError } from './errors.js'

const CITY_BOUNDS = {
  hcm: { west: 106.34, south: 10.34, east: 107.05, north: 11.2 },
  hanoi: { west: 105.28, south: 20.55, east: 106.04, north: 21.4 },
  danang: { west: 107.78, south: 15.88, east: 108.42, north: 16.3 },
} as const

export class RouteService {
  constructor(private readonly osrmUrls: RuntimeConfig['osrmUrls']) {}

  inferCity(coordinate: Coordinate): RouteRequest['city'] {
    for (const [city, bounds] of Object.entries(CITY_BOUNDS)) {
      if (
        coordinate.lng >= bounds.west &&
        coordinate.lng <= bounds.east &&
        coordinate.lat >= bounds.south &&
        coordinate.lat <= bounds.north
      ) {
        return city as RouteRequest['city']
      }
    }
    throw new RouteServiceError('OUTSIDE_ROUTING_AREA', 'Coordinate is outside configured routing areas.')
  }

  async calculate(input: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
    const request = RouteRequestSchema.parse(input)
    const baseUrl = this.osrmUrls[request.city]
    const path = `${request.origin.lng},${request.origin.lat};${request.destination.lng},${request.destination.lat}`
    const url = new URL(`/route/v1/${request.profile}/${path}`, baseUrl)
    url.searchParams.set('overview', 'full')
    url.searchParams.set('geometries', 'geojson')
    url.searchParams.set('steps', String(request.steps))

    const timeout = AbortSignal.timeout(10_000)
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(url, { signal: combinedSignal })
    } catch (error) {
      throw new RouteServiceError(
        'OSRM_OFFLINE',
        error instanceof Error ? `OSRM request failed: ${error.message}` : 'OSRM request failed.',
      )
    }

    if (!response.ok) {
      throw new RouteServiceError('OSRM_OFFLINE', `OSRM returned HTTP ${response.status}.`)
    }

    const payload = (await response.json()) as {
      code?: string
      message?: string
      routes?: Array<{ distance?: number; duration?: number; geometry?: unknown }>
    }
    if (payload.code === 'NoRoute') {
      throw new RouteServiceError('NO_ROUTE', payload.message || 'No route was found.')
    }
    const route = payload.routes?.[0]
    if (payload.code !== 'Ok' || !route) {
      throw new RouteServiceError('INVALID_RESPONSE', payload.message || 'OSRM returned an invalid response.')
    }

    return RouteResultSchema.parse({
      code: 'Ok',
      distance_meters: route.distance,
      duration_seconds: route.duration,
      geometry: route.geometry,
    })
  }
}
