import { AhaMoveApiError } from './errors.js'
import type { AhaMoveConfig } from './config.js'

export interface AhaMoveClientOptions {
  baseUrl: string
  timeoutMs: number
  token?: string
  apiKey?: string
  mobile?: string
  fetch?: typeof fetch
}

export class AhaMoveClient {
  private token?: string
  private readonly fetcher: typeof fetch

  constructor(private readonly options: AhaMoveClientOptions) {
    this.token = options.token
    this.fetcher = options.fetch || fetch
  }

  static fromConfig(config: AhaMoveConfig) {
    return new AhaMoveClient(config)
  }

  async listCities(countryId = 'VN') {
    return this.request<unknown[]>('GET', '/cities', undefined, { country_id: countryId })
  }

  async listServices(input: { city_id?: string; lat?: number; lng?: number; delivery_type?: string }) {
    return this.request<unknown[]>('GET', '/services', undefined, input)
  }

  async getService(serviceId: string) {
    return this.request<unknown>('GET', `/services/${encodeURIComponent(serviceId)}`)
  }

  async estimateOrder(payload: Record<string, unknown>) {
    return this.request<unknown>('POST', '/orders/estimates', payload)
  }

  async createOrder(payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('POST', '/orders', payload)
  }

  async getOrder(orderId: string) {
    return this.request<Record<string, unknown>>('GET', `/orders/${encodeURIComponent(orderId)}`)
  }

  async getOrders(orderIds: string[]) {
    return this.request<unknown>('GET', '/orders', undefined, { ids: orderIds.join(',') })
  }

  async findOrdersByTrackingNumber(trackingNumber: string, fromTime?: number, toTime?: number) {
    return this.request<unknown>(
      'GET',
      `/orders/tracks/${encodeURIComponent(trackingNumber)}`,
      undefined,
      { from_time: fromTime, to_time: toTime },
    )
  }

  async getTrackingLink(orderId: string) {
    return this.request<{ shared_link: string }>('GET', `/orders/${encodeURIComponent(orderId)}/shared-link`)
  }

  async getCallbackLogs(trackingNumber: string) {
    return this.request<Record<string, unknown>>('GET', '/orders/callback-logs', undefined, {
      tracking_number: trackingNumber,
    })
  }

  async updateOrder(orderId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PATCH', `/orders/${encodeURIComponent(orderId)}`, payload)
  }

  async cancelOrder(orderId: string, comment: string) {
    return this.request<Record<string, unknown>>('DELETE', `/orders/${encodeURIComponent(orderId)}`, { comment })
  }

  async cancelOrderByTrackingNumber(trackingNumber: string, comment: string) {
    return this.request<Record<string, unknown>>('DELETE', '/orders/tracks', {
      tracking_number: trackingNumber,
      comment,
    })
  }

  async rateDriver(orderId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/orders/${encodeURIComponent(orderId)}/rate`, payload)
  }

  private async getToken() {
    if (this.token) return this.token
    if (!this.options.apiKey || !this.options.mobile) {
      throw new AhaMoveApiError('AUTHENTICATION_ERROR', 'AhaMove credentials are not configured.', false, 401)
    }
    const response = await this.rawRequest<{ token?: string }>('POST', '/accounts/token', {
      mobile: this.options.mobile,
      api_key: this.options.apiKey,
    }, undefined, false)
    if (!response.token) {
      throw new AhaMoveApiError('PROVIDER_INVALID_RESPONSE', 'AhaMove token response did not contain a token.', false, 502)
    }
    this.token = response.token
    return response.token
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ) {
    await this.getToken()
    try {
      return await this.rawRequest<T>(method, path, body, query, true)
    } catch (error) {
      if (error instanceof AhaMoveApiError && error.httpStatus === 401 && this.options.apiKey && this.options.mobile) {
        this.token = undefined
        await this.getToken()
        return this.rawRequest<T>(method, path, body, query, true)
      }
      throw error
    }
  }

  private async rawRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
    authenticated = true,
  ): Promise<T> {
    const url = new URL(`${this.options.baseUrl}${path}`)
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body) headers['Content-Type'] = 'application/json'
    if (authenticated && this.token) headers.Authorization = `Bearer ${this.token}`
    let response: Response
    try {
      response = await this.fetcher(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error) {
      throw new AhaMoveApiError(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error ? `AhaMove request failed: ${error.message}` : 'AhaMove request failed.',
        true,
        503,
      )
    }
    const text = await response.text()
    let payload: unknown = {}
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        throw new AhaMoveApiError('PROVIDER_INVALID_RESPONSE', 'AhaMove returned invalid JSON.', false, 502)
      }
    }
    if (!response.ok) throw providerError(response.status, payload)
    return payload as T
  }
}

function providerError(status: number, payload: unknown) {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const providerCode = typeof record.code === 'string'
    ? record.code
    : typeof record.error === 'string' ? record.error : undefined
  const providerMessage = typeof record.message === 'string' ? record.message : `AhaMove returned HTTP ${status}.`
  if (status === 401) return new AhaMoveApiError('AUTHENTICATION_ERROR', providerMessage, false, status, providerCode)
  if (status === 403) return new AhaMoveApiError('PROVIDER_FORBIDDEN', providerMessage, false, status, providerCode)
  if (status === 404) return new AhaMoveApiError('PROVIDER_NOT_FOUND', providerMessage, false, status, providerCode)
  if (status === 409) return new AhaMoveApiError('PROVIDER_CONFLICT', providerMessage, false, status, providerCode)
  if (status === 429) return new AhaMoveApiError('PROVIDER_RATE_LIMITED', providerMessage, true, status, providerCode)
  if (status === 406 && providerCode === 'INVALID_ORDER_STATUS') {
    return new AhaMoveApiError('INVALID_ORDER_STATUS', providerMessage, false, status, providerCode)
  }
  return new AhaMoveApiError(
    status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'VALIDATION_ERROR',
    providerMessage,
    status >= 500,
    status,
    providerCode,
  )
}
