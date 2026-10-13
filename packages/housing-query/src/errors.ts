export class QueryValidationError extends Error {
  readonly code = 'QUERY_VALIDATION_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'QueryValidationError'
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND'

  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class RouteServiceError extends Error {
  constructor(
    readonly code: 'OSRM_OFFLINE' | 'NO_ROUTE' | 'OUTSIDE_ROUTING_AREA' | 'INVALID_RESPONSE' | 'TIMEOUT' | 'CANCELLED',
    message: string,
  ) {
    super(message)
    this.name = 'RouteServiceError'
  }
}

export class OperationError extends Error {
  constructor(readonly code: 'TIMEOUT' | 'CANCELLED' | 'UNAVAILABLE', message: string) {
    super(message)
    this.name = 'OperationError'
  }
}
