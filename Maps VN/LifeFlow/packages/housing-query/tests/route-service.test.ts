import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteService } from '../src/route-service.js'

const profiles = { driving: 'http://127.0.0.1:5000', walking: 'http://127.0.0.1:5010', motorcycle: 'http://127.0.0.1:5020' }
const service = new RouteService({ hcm: profiles, hanoi: profiles, danang: profiles })
const request = {
  city: 'hcm' as const, profile: 'walking' as const, steps: false,
  origin: { lng: 106.7, lat: 10.77 }, destination: { lng: 106.701, lat: 10.771 }, snap_radius_m: 100,
}
const valid = {
  code: 'Ok', waypoints: [{ distance: 20 }, { distance: 30 }],
  routes: [{ distance: 1_800, duration: 600, geometry: { type: 'LineString', coordinates: [[106.7, 10.77], [106.701, 10.771]] } }],
}

afterEach(() => vi.unstubAllGlobals())

describe('bounded OSRM snapping', () => {
  it('passes the radius and reports endpoint snapping separately from road distance', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(valid)))
    vi.stubGlobal('fetch', fetchMock)
    expect(await service.calculate(request)).toMatchObject({ distance_meters: 1_800, snap_distances_meters: [20, 30] })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('radiuses=100%3B100')
  })

  it.each([
    null,
    { ...valid, waypoints: {} },
    { ...valid, waypoints: [null, null] },
    { ...valid, waypoints: undefined },
    { ...valid, waypoints: [{ distance: 101 }, { distance: 20 }] },
    { ...valid, waypoints: [{ distance: -1 }, { distance: 20 }] },
    { ...valid, routes: [{ ...valid.routes[0], distance: -1 }] },
  ])('rejects invalid routing evidence', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))))
    await expect(service.calculate(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each(['NoRoute', 'NoSegment'])('handles %s with HTTP 400 as unroutable', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code }), { status: 400 })))
    await expect(service.calculate(request)).rejects.toMatchObject({ code: 'NO_ROUTE' })
  })

  it('does not convert malformed JSON into an empty search', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not JSON')))
    await expect(service.calculate(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('routing coverage and cancellation', () => {
  it.each(['origin', 'destination'] as const)('rejects an out-of-city %s before fetching', async (side) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(service.calculate({ ...request, [side]: { lng: 105.85, lat: 21.03 } })).rejects.toMatchObject({ code: 'OUTSIDE_ROUTING_AREA' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('distinguishes cancellation from OSRM being offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      options.signal.throwIfAborted()
    }))
    await expect(service.calculate(request, AbortSignal.abort())).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})
