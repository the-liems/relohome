export type MovingErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PROVIDER_FORBIDDEN'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_CONFLICT'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_RESPONSE'
  // The provider understood the request but refused it (e.g. booking time too far ahead).
  | 'PROVIDER_REJECTED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALID'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_CONFLICT'
  | 'WRITE_DISABLED'
  | 'INVALID_ORDER_STATUS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'

export class MovingServiceError extends Error {
  constructor(
    readonly code: MovingErrorCode,
    message: string,
    readonly retryable = false,
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'MovingServiceError'
  }
}

export class AhaMoveApiError extends MovingServiceError {
  constructor(
    code: MovingErrorCode,
    message: string,
    retryable: boolean,
    httpStatus: number | undefined,
    readonly providerCode?: string,
  ) {
    super(code, message, retryable, httpStatus)
    this.name = 'AhaMoveApiError'
  }
}
