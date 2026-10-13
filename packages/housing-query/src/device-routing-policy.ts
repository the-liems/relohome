import type { DeviceRoutingPolicy } from '@relohome/contracts'
import { OperationError, RouteServiceError } from './errors.js'

export function deviceRoutingPolicy(request: {
  routing_policy?: DeviceRoutingPolicy; public_routing_consent?: boolean,
}): DeviceRoutingPolicy {
  return request.routing_policy ?? (request.public_routing_consent ? 'public' : 'local')
}

/** Only an unavailable/insufficient local graph permits a public retry.
 * Validation, malformed evidence and cancellation are never hidden by fallback. */
export function canFallbackDeviceRoute(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false
  if (error instanceof OperationError) return error.code === 'TIMEOUT'
  return error instanceof RouteServiceError &&
    ['OUTSIDE_ROUTING_AREA', 'OSRM_OFFLINE', 'NO_ROUTE', 'TIMEOUT'].includes(error.code)
}
