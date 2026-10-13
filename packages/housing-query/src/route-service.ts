import {
  RouteRequestSchema,
  RouteResultSchema,
  type Coordinate,
  type RouteRequest,
  type RouteResult,
  type DeviceRoutingPolicy,
} from '@relohome/contracts'
import type { RuntimeConfig } from './config.js'
import { RouteServiceError } from './errors.js'
import { abortError, checkOperation, operationContext } from './execution.js'
import { setTimeout as delay } from 'node:timers/promises'
import { canFallbackDeviceRoute } from './device-routing-policy.js'

const CITY_BOUNDS = {
  hcm: { west: 106.34, south: 10.34, east: 107.05, north: 11.2 },
  hanoi: { west: 105.28, south: 20.55, east: 106.04, north: 21.4 },
  danang: { west: 107.78, south: 15.88, east: 108.42, north: 16.3 },
} as const

export class RouteService {
  private nextPublicRequestAt = 0
  constructor(
    private readonly osrmUrls: RuntimeConfig['osrmUrls'],
    private readonly publicDrivingUrl?: string,
  ) {}

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
    checkOperation()
    const request = RouteRequestSchema.parse(input)
    const bounds = CITY_BOUNDS[request.city]
    for (const side of ['origin', 'destination'] as const) {
      const point = request[side]
      if (point.lng < bounds.west || point.lng > bounds.east || point.lat < bounds.south || point.lat > bounds.north) {
        throw new RouteServiceError('OUTSIDE_ROUTING_AREA', `${side} is outside the ${request.city} routing bounds.`)
      }
    }
    const baseUrl = this.osrmUrls[request.city][request.profile]
    return this.fetchRoute(request, baseUrl, signal)
  }

  // Called only by the browser device-route API with public/auto policy. Not an
  // automatic fallback for MCP/commute queries; no silently changed coordinates.
  async calculatePublicDriving(input: Omit<RouteRequest, 'city'>, signal?: AbortSignal): Promise<RouteResult> {
    checkOperation()
    if (!this.publicDrivingUrl) {
      throw new RouteServiceError('OSRM_OFFLINE', 'Public driving routing is not configured.')
    }
    const request = RouteRequestSchema.omit({ city: true }).parse(input)
    if (request.profile !== 'driving') throw new RouteServiceError('INVALID_RESPONSE', 'Only driving is supported for public routing.')
    const start = Math.max(Date.now(), this.nextPublicRequestAt)
    if (start - Date.now() > 4_000) throw new RouteServiceError('OSRM_OFFLINE', 'Public routing is busy; retry later.')
    this.nextPublicRequestAt = start + 1_100
    const signals = [signal, operationContext()?.signal].filter((item): item is AbortSignal => Boolean(item))
    const combined = AbortSignal.any(signals)
    try {
      await delay(Math.max(0, start - Date.now()), undefined, { signal: combined })
    } catch {
      throw abortError(combined)
    }
    return this.fetchRoute(request, this.publicDrivingUrl, combined, true)
  }

  /** Browser directions only. Local/MCP/commute callers retain their old policy. */
  async calculateDeviceDriving(input: Omit<RouteRequest, 'city'>, policy: DeviceRoutingPolicy, signal?: AbortSignal) {
    if (policy !== 'public') {
      try {
        // Reserve time for one public attempt instead of spending the whole
        // operation budget waiting for a missing/unreachable local engine.
        const localSignal = policy === 'auto'
          ? AbortSignal.any([AbortSignal.timeout(2_500), ...(signal ? [signal] : [])])
          : signal
        const route = await this.calculate({ ...input, city: this.inferCity(input.destination) }, localSignal)
        return { route, routing_provider: 'local_osrm' as const }
      } catch (error) {
        if (policy === 'local' || !canFallbackDeviceRoute(error, signal)) throw error
        checkOperation() // Never restart an expired/cancelled overall operation.
      }
    }
    const route = await this.calculatePublicDriving(input, signal)
    return { route, routing_provider: 'public_osrm' as const }
  }

  private async fetchRoute(
    request: Omit<RouteRequest, 'city'>, baseUrl: string, signal?: AbortSignal, publicProvider = false,
  ): Promise<RouteResult> {
    const path = `${request.origin.lng},${request.origin.lat};${request.destination.lng},${request.destination.lat}`
    // Preserve the public endpoint's /routed-car/ prefix.
    const url = new URL(`route/v1/${request.profile}/${path}`, baseUrl.replace(/\/?$/, '/'))
    url.searchParams.set('overview', 'full')
    url.searchParams.set('geometries', 'geojson')
    url.searchParams.set('steps', String(request.steps))
    if (request.snap_radius_m !== undefined) {
      url.searchParams.set('radiuses', `${request.snap_radius_m};${request.snap_radius_m}`)
    }

    const timeout = AbortSignal.timeout(10_000)
    const signals = [timeout, signal, operationContext()?.signal].filter((item): item is AbortSignal => Boolean(item))
    const combinedSignal = AbortSignal.any(signals)

    let response: Response
    try {
      response = await fetch(url, {
        signal: combinedSignal,
        ...(publicProvider ? { headers: { 'User-Agent': 'ReloHome/1.0 (+https://github.com/AI20K-Build-Phase-Cohort-4/P-044)' } } : {}),
      })
    } catch (error) {
      if (combinedSignal.aborted) throw abortError(combinedSignal)
      throw new RouteServiceError(
        'OSRM_OFFLINE',
        error instanceof Error ? `OSRM request failed: ${error.message}` : 'OSRM request failed.',
      )
    }

    if (!response.ok && response.status !== 400) {
      throw new RouteServiceError('OSRM_OFFLINE', `OSRM returned HTTP ${response.status}.`)
    }

    const payload = (await response.json().catch(() => {
      if (combinedSignal.aborted) throw abortError(combinedSignal)
      throw new RouteServiceError('INVALID_RESPONSE', 'OSRM returned invalid JSON.')
    })) as {
      code?: string
      message?: string
      routes?: Array<{ distance?: number; duration?: number; geometry?: unknown }>
      waypoints?: Array<{ distance?: number }>
    }
    if (combinedSignal.aborted) throw abortError(combinedSignal)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new RouteServiceError('INVALID_RESPONSE', 'OSRM returned an invalid response object.')
    }
    if (payload.code === 'NoRoute' || payload.code === 'NoSegment') {
      throw new RouteServiceError('NO_ROUTE', payload.message || 'No route was found.')
    }
    const route = payload.routes?.[0]
    if (payload.code !== 'Ok' || !route) {
      throw new RouteServiceError('INVALID_RESPONSE', payload.message || 'OSRM returned an invalid response.')
    }

    const snapDistances = Array.isArray(payload.waypoints) ? payload.waypoints.map((waypoint) => waypoint?.distance) : undefined
    if (request.snap_radius_m !== undefined &&
        (snapDistances?.length !== 2 || snapDistances.some((distance) =>
          typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 || distance > request.snap_radius_m!))) {
      throw new RouteServiceError('INVALID_RESPONSE', 'OSRM returned invalid snapping distances.')
    }
    const result = RouteResultSchema.safeParse({
      code: 'Ok',
      distance_meters: route.distance,
      duration_seconds: route.duration,
      geometry: route.geometry,
      ...(snapDistances ? { snap_distances_meters: snapDistances } : {}),
    })
    if (!result.success) throw new RouteServiceError('INVALID_RESPONSE', 'OSRM returned invalid route data.')
    return result.data
  }
}
