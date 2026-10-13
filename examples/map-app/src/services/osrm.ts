import type { Coordinates, RouteProfile, RouteResult } from '../types'

interface OsrmPayload {
  code?: string
  message?: string
  routes?: Array<{
    distance: number
    duration: number
    geometry: {
      type: 'LineString'
      coordinates: Coordinates[]
    }
  }>
}

export async function fetchRoute(
  baseUrl: string,
  profile: RouteProfile,
  start: Coordinates,
  end: Coordinates,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const coordinates = `${start[0]},${start[1]};${end[0]},${end[1]}`
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
  })
  const url = `${baseUrl}/route/v1/${profile}/${coordinates}?${params}`

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`OSRM không phản hồi (${response.status}).`)
  }

  const payload = (await response.json()) as OsrmPayload
  if (payload.code !== 'Ok' || !payload.routes?.[0]) {
    throw new Error(payload.message || 'Không tìm thấy tuyến đường phù hợp.')
  }

  const route = payload.routes[0]
  if (!route.geometry?.coordinates?.length) {
    throw new Error('OSRM không trả về hình học tuyến đường.')
  }

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry: {
      type: 'Feature',
      properties: {},
      geometry: route.geometry,
    },
  }
}
