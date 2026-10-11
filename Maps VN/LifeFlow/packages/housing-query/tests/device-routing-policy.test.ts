// Pure policy/config checks; no fake GPS, route payloads or fetch mocks.
import { describe, expect, it } from 'vitest'
import { deviceRoutingPolicy, canFallbackDeviceRoute } from '../src/device-routing-policy.js'
import { OperationError, RouteServiceError } from '../src/errors.js'
import { resolvePublicDrivingOsrmUrl } from '../src/config.js'

describe('browser routing policy', () => {
  it('keeps legacy clients local unless they explicitly requested public routing', () => {
    expect(deviceRoutingPolicy({})).toBe('local')
    expect(deviceRoutingPolicy({ public_routing_consent: false })).toBe('local')
    expect(deviceRoutingPolicy({ public_routing_consent: true })).toBe('public')
  })
  it('gives the explicit modern policy priority over legacy flags', () => {
    for (const routing_policy of ['auto', 'local', 'public'] as const) {
      for (const public_routing_consent of [true, false])
        expect(deviceRoutingPolicy({ routing_policy, public_routing_consent })).toBe(routing_policy)
    }
  })
  it('only falls back for local coverage, connectivity, no-road or timeout failures', () => {
    for (const code of ['OUTSIDE_ROUTING_AREA', 'OSRM_OFFLINE', 'NO_ROUTE', 'TIMEOUT'] as const)
      expect(canFallbackDeviceRoute(new RouteServiceError(code, code))).toBe(true)
    expect(canFallbackDeviceRoute(new OperationError('TIMEOUT', 'local deadline'))).toBe(true)
    for (const error of [new Error('unknown'), new RouteServiceError('INVALID_RESPONSE', 'bad response'),
      new RouteServiceError('CANCELLED', 'cancelled'), new OperationError('CANCELLED', 'cancelled'),
      new OperationError('UNAVAILABLE', 'storage unavailable')])
      expect(canFallbackDeviceRoute(error)).toBe(false)
  })
  it('never forwards coordinates after the caller cancelled', () => {
    expect(canFallbackDeviceRoute(new RouteServiceError('OSRM_OFFLINE', 'offline'), AbortSignal.abort())).toBe(false)
    expect(canFallbackDeviceRoute(new OperationError('TIMEOUT', 'deadline'), AbortSignal.abort())).toBe(false)
  })
})

describe('approved public provider configuration', () => {
  it('defaults unset values to the approved endpoint but preserves an explicit empty kill switch', () => {
    expect(resolvePublicDrivingOsrmUrl(undefined)).toBe('https://routing.openstreetmap.de/routed-car/')
    expect(resolvePublicDrivingOsrmUrl('')).toBeUndefined()
    expect(resolvePublicDrivingOsrmUrl('https://routing.openstreetmap.de/routed-car/'))
      .toBe('https://routing.openstreetmap.de/routed-car/')
  })
  it('rejects unapproved hosts, protocol, paths, credentials and query strings', () => {
    for (const value of ['https://example.invalid/', 'http://routing.openstreetmap.de/routed-car/',
      'https://routing.openstreetmap.de/routed-bike/', 'https://user@routing.openstreetmap.de/routed-car/',
      'https://routing.openstreetmap.de/routed-car/?query=1'])
      expect(() => resolvePublicDrivingOsrmUrl(value)).toThrow('approved HTTPS')
  })
})
