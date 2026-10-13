import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  CancelMoveOrderRequestSchema,
  CreateMoveOrderRequestSchema,
  EstimateMoveRequestSchema,
  MoveQuoteSchema,
  RateMoveDriverRequestSchema,
  RegisterMovingApprovalRequestSchema,
  UpdateMoveOrderRequestSchema,
  type CancelMoveOrderRequest,
  type CreateMoveOrderRequest,
  type EstimateMoveRequest,
  type RateMoveDriverRequest,
  type UpdateMoveOrderRequest,
} from '@relohome/contracts'
import type { MovingRuntimeConfig } from './config.js'
import { AhaMoveClient } from './ahamove-client.js'
import { MovingServiceError } from './errors.js'
import { payloadHash } from './hash.js'
import {
  normalizeCity,
  normalizeOrder,
  splitQuoteOptions,
  normalizeService,
  redactCredentials,
  toAhaMoveOrderBase,
} from './mapper.js'
import { MovingRepository, type ApprovalRecord } from './repository.js'

const cancellableStatuses = new Set(['IDLE', 'ASSIGNING', 'ACCEPTED', 'CONFIRMING', 'PAYING'])
const editableStatuses = new Set(['IDLE', 'ASSIGNING', 'ACCEPTED'])
const terminalStatuses = new Set(['COMPLETED', 'CANCELLED'])
const statusRank: Record<string, number> = {
  IDLE: 0,
  ASSIGNING: 1,
  CONFIRMING: 1,
  PAYING: 1,
  ACCEPTED: 2,
  'IN PROCESS': 3,
  IN_PROCESS: 3,
  COMPLETED: 4,
  CANCELLED: 4,
}

export class MovingService {
  constructor(
    private readonly client: AhaMoveClient,
    private readonly repository: MovingRepository,
    private readonly config: MovingRuntimeConfig,
  ) {}

  async listCities(countryId = 'VN') {
    const values = await this.client.listCities(countryId)
    return values.map(normalizeCity)
  }

  async listServices(input: { city_id?: string; lat?: number; lng?: number; delivery_type?: string }) {
    if (!input.city_id && (input.lat === undefined || input.lng === undefined)) {
      throw new MovingServiceError('VALIDATION_ERROR', 'Provide city_id or both lat and lng.')
    }
    const values = await this.client.listServices(input)
    return values.map(normalizeService)
  }

  async getService(serviceId: string) {
    const payload = await this.client.getService(serviceId)
    const value = Array.isArray(payload) ? payload[0] : payload
    if (!value) throw new MovingServiceError('PROVIDER_NOT_FOUND', `Service not found: ${serviceId}`)
    return normalizeService(value)
  }

  async estimate(input: EstimateMoveRequest) {
    const request = EstimateMoveRequestSchema.parse(input)
    const providerPayload = {
      ...toAhaMoveOrderBase(request.draft),
      services: request.services.map((service) => ({
        _id: service.service_id,
        requests: service.requests.map((item) => ({
          _id: item.request_id,
          num: item.quantity,
          tier_code: item.tier_code,
          option_id: item.option_id,
        })),
      })),
    }
    const providerResponse = await this.client.estimateOrder(providerPayload)
    const { options, rejected } = splitQuoteOptions(providerResponse)
    if (!options.length && rejected.length) {
      // Nothing was priced: surface the provider's own reason so the caller can ask the user.
      const reasons = [...new Set(rejected.map((r) => (r.code ? `${r.message} (${r.code})` : r.message)))]
      throw new MovingServiceError('PROVIDER_REJECTED', `AhaMove từ chối báo giá: ${reasons.join('; ')}`, false, 406)
    }
    const now = new Date()
    const quote = MoveQuoteSchema.parse({
      contract_version: '1.0.0',
      quote_id: randomUUID(),
      provider: 'ahamove',
      environment: this.config.environment,
      request_fingerprint: payloadHash(request),
      observed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.config.quoteTtlSeconds * 1000).toISOString(),
      options,
      warnings: rejected.map((r) => `${r.service_id || 'Dịch vụ'}: ${r.message}`),
    })
    await this.repository.saveQuote(quote, request as unknown as Record<string, unknown>)
    return quote
  }

  createApprovalPayload(input: CreateMoveOrderRequest, quoteFingerprint: string, totalPrice: number) {
    return {
      action: 'create',
      quote_id: input.quote_id,
      quote_fingerprint: quoteFingerprint,
      service_id: input.service_id,
      total_price: totalPrice,
      workflow_id: input.workflow_id,
      action_id: input.action_id,
    }
  }

  async registerApproval(input: {
    approvalId?: string
    actionType: ApprovalRecord['actionType']
    payload: Record<string, unknown>
    approvedBy: string
    expiresAt: Date
  }) {
    const approvalId = input.approvalId || randomUUID()
    const parsed = RegisterMovingApprovalRequestSchema.safeParse({
      approval_id: approvalId, action_type: input.actionType, payload: input.payload,
      approved_by: input.approvedBy,
      expires_at: Number.isFinite(input.expiresAt.getTime()) ? input.expiresAt.toISOString() : '',
    })
    if (!parsed.success) throw new MovingServiceError('VALIDATION_ERROR', 'Invalid approval registration.')
    const remaining = input.expiresAt.getTime() - Date.now()
    if (remaining <= 0) throw new MovingServiceError('APPROVAL_EXPIRED', 'Approval expiry must be in the future.')
    if (remaining > 30 * 60 * 1000) {
      throw new MovingServiceError('VALIDATION_ERROR', 'Approval lifetime must not exceed 30 minutes.')
    }
    await this.repository.saveApproval({
      approvalId,
      actionType: input.actionType,
      payloadHash: payloadHash(parsed.data.payload),
      approvedBy: parsed.data.approved_by,
      expiresAt: input.expiresAt,
    })
    return approvalId
  }

  async createOrder(input: CreateMoveOrderRequest) {
    this.requireWrites()
    const request = CreateMoveOrderRequestSchema.parse(input)
    const stored = await this.repository.getQuote(request.quote_id)
    if (!stored) throw new MovingServiceError('QUOTE_NOT_FOUND', `Quote not found: ${request.quote_id}`)
    if (new Date(stored.quote.expires_at).getTime() <= Date.now()) {
      throw new MovingServiceError('QUOTE_EXPIRED', 'The selected quote has expired. Request a new estimate.')
    }
    const option = stored.quote.options.find((item) => item.service_id === request.service_id)
    if (!option) throw new MovingServiceError('VALIDATION_ERROR', 'The selected service is not part of the quote.')
    const approvalPayload = this.createApprovalPayload(
      request,
      stored.quote.request_fingerprint,
      option.fee.total_price,
    )
    const idempotencyKey = payloadHash({
      workflow_id: request.workflow_id,
      action_id: request.action_id,
      quote_id: request.quote_id,
      service_id: request.service_id,
    })
    const existing = await this.repository.getAction(idempotencyKey)
    if (existing?.status === 'completed' && existing.response_payload) {
      return normalizeOrder(existing.response_payload as Record<string, unknown>, this.config.environment)
    }
    if (existing) {
      throw new MovingServiceError('IDEMPOTENCY_CONFLICT', 'This order action is already pending or failed reconciliation.')
    }
    await this.verifyApproval(request.approval_id, 'create', approvalPayload)
    const claimed = await this.repository.claimAction(
      idempotencyKey,
      request.workflow_id,
      request.action_id,
      stored.quote.request_fingerprint,
    )
    if (!claimed) throw new MovingServiceError('IDEMPOTENCY_CONFLICT', 'Could not reserve the order action.')
    if (!await this.repository.consumeApproval(request.approval_id)) {
      await this.repository.failAction(idempotencyKey, 'APPROVAL_INVALID')
      throw new MovingServiceError('APPROVAL_INVALID', 'Approval could not be consumed.')
    }

    const estimateRequest = EstimateMoveRequestSchema.parse(stored.request)
    const selected = estimateRequest.services.find((item) => item.service_id === request.service_id)
    if (!selected) throw new MovingServiceError('VALIDATION_ERROR', 'Selected service request is missing.')
    const providerPayload = {
      ...toAhaMoveOrderBase(estimateRequest.draft),
      service_id: selected.service_id,
      requests: selected.requests.map((item) => ({
        _id: item.request_id,
        num: item.quantity,
        tier_code: item.tier_code,
        option_id: item.option_id,
      })),
    }
    try {
        const created = await this.client.createOrder(providerPayload)
        // Create may return an acknowledgement (order_id/shared_link), not a full order.
      // Read back the real order; never fabricate a status or repeat POST to fill fields.
      const createdId = typeof created._id === 'string' ? created._id : created.order_id
      const providerOrder = typeof createdId === 'string'
        ? await this.client.getOrder(createdId)
        : created
      const order = normalizeOrder(providerOrder, this.config.environment)
      await this.repository.completeAction(idempotencyKey, order.order_id, providerOrder)
      await this.repository.upsertOrder(order.order_id, order.status, providerOrder)
      return order
    } catch (error) {
      if (!(error instanceof MovingServiceError) || error.retryable || error.code === 'PROVIDER_INVALID_RESPONSE') {
        const tracking = estimateRequest.draft.destinations.find((point) => point.tracking_number)?.tracking_number
        if (tracking) {
          const matches = asRecordArray(await this.client.findOrdersByTrackingNumber(tracking).catch(() => []))
          // Multiple orders sharing a reference are ambiguous; never select one arbitrarily.
          const providerOrder = matches.length === 1 ? matches[0] : undefined
          if (providerOrder) {
            try {
              const fullOrder = await this.client.getOrder(String(providerOrder._id))
              const order = normalizeOrder(fullOrder, this.config.environment)
              await this.repository.completeAction(idempotencyKey, order.order_id, fullOrder)
              await this.repository.upsertOrder(order.order_id, order.status, fullOrder)
              return order
            } catch {
              // Keep the pending action fence if read-back or persistence is unavailable.
            }
          }
        }
      } else if (error instanceof MovingServiceError) {
        await this.repository.failAction(idempotencyKey, error.code)
      }
      if (!(error instanceof MovingServiceError) || error.retryable || error.code === 'PROVIDER_INVALID_RESPONSE') {
        throw new MovingServiceError('PROVIDER_INVALID_RESPONSE', 'Order may have been created; reconcile by tracking number before any retry.', true)
      }
      throw error
    }
  }

  async getOrder(orderId: string, includeTrackingLink = false) {
    const payload = await this.client.getOrder(orderId)
    if (includeTrackingLink) {
      const link = await this.client.getTrackingLink(orderId)
      payload.shared_link = link.shared_link
    }
    const order = normalizeOrder(payload, this.config.environment)
    await this.repository.upsertOrder(order.order_id, order.status, payload)
    return order
  }

  async getOrders(orderIds: string[]) {
    if (orderIds.length < 1 || orderIds.length > 100) {
      throw new MovingServiceError('VALIDATION_ERROR', 'Provide between 1 and 100 order IDs.')
    }
    return asRecordArray(await this.client.getOrders(orderIds))
      .map((item) => normalizeOrder(item, this.config.environment))
  }

  async findOrdersByTrackingNumber(trackingNumber: string, fromTime?: number, toTime?: number) {
    return asRecordArray(await this.client.findOrdersByTrackingNumber(trackingNumber, fromTime, toTime))
      .map((item) => normalizeOrder(item, this.config.environment))
  }

  getCallbackLogs(trackingNumber: string) {
    return this.client.getCallbackLogs(trackingNumber).then(redactCredentials)
  }

  getTrackingLink(orderId: string) {
    return this.client.getTrackingLink(orderId)
  }

  async updateOrder(input: UpdateMoveOrderRequest) {
    this.requireWrites()
    const request = UpdateMoveOrderRequestSchema.parse(input)
    const current = await this.getOrder(request.order_id)
    if (!editableStatuses.has(current.status)) {
      throw new MovingServiceError('INVALID_ORDER_STATUS', `Order cannot be updated in status ${current.status}.`)
    }
    const { approval_id, order_id, address_info, ...updates } = request
    const actionPayload = { action: 'update', order_id, address_info, ...updates }
    await this.verifyApproval(approval_id, 'update', actionPayload)
    if (!await this.repository.consumeApproval(approval_id)) {
      throw new MovingServiceError('APPROVAL_INVALID', 'Approval could not be consumed.')
    }
    const payload = {
      ...updates,
      address_info: address_info ? {
        address: address_info.address,
        lat: address_info.coordinate?.lat,
        lng: address_info.coordinate?.lng,
      } : undefined,
    }
    await this.client.updateOrder(order_id, payload)
    return this.getOrder(order_id)
  }

  async cancelOrder(input: CancelMoveOrderRequest) {
    this.requireWrites()
    const request = CancelMoveOrderRequestSchema.parse(input)
    let orderId = request.order_id
    if (!orderId && request.tracking_number) {
      const matches = await this.findOrdersByTrackingNumber(request.tracking_number)
      if (matches.length > 1) {
        throw new MovingServiceError('VALIDATION_ERROR', 'Tracking number matches multiple orders; provide an exact order ID.')
      }
      orderId = matches[0]?.order_id
    }
    if (!orderId) throw new MovingServiceError('PROVIDER_NOT_FOUND', 'No AhaMove order matched the request.')
    const current = await this.getOrder(orderId)
    if (!cancellableStatuses.has(current.status)) {
      throw new MovingServiceError('INVALID_ORDER_STATUS', `Order cannot be cancelled in status ${current.status}.`)
    }
    const actionPayload = {
      action: 'cancel',
      order_id: request.order_id,
      tracking_number: request.tracking_number,
      comment: request.comment,
    }
    await this.verifyApproval(request.approval_id, 'cancel', actionPayload)
    if (!await this.repository.consumeApproval(request.approval_id)) {
      throw new MovingServiceError('APPROVAL_INVALID', 'Approval could not be consumed.')
    }
    if (request.tracking_number) {
      await this.client.cancelOrderByTrackingNumber(request.tracking_number, request.comment)
    } else {
      await this.client.cancelOrder(orderId, request.comment)
    }
    return this.getOrder(orderId)
  }

  async rateDriver(input: RateMoveDriverRequest) {
    this.requireWrites()
    if (!this.config.ratingEnabled) throw new MovingServiceError('WRITE_DISABLED', 'Driver rating is disabled.')
    const request = RateMoveDriverRequestSchema.parse(input)
    const current = await this.getOrder(request.order_id)
    if (current.status !== 'COMPLETED') {
      throw new MovingServiceError('INVALID_ORDER_STATUS', 'Driver rating is only allowed for completed orders.')
    }
    const { approval_id, ...payload } = request
    await this.verifyApproval(approval_id, 'rate', { action: 'rate', ...payload })
    if (!await this.repository.consumeApproval(approval_id)) {
      throw new MovingServiceError('APPROVAL_INVALID', 'Approval could not be consumed.')
    }
    await this.client.rateDriver(request.order_id, {
      rated_by: request.rated_by,
      rating: request.rating,
      comment: request.comment,
    })
    return { rated: true, order_id: request.order_id }
  }

  async ingestWebhook(payload: Record<string, unknown>) {
    const rawId = typeof payload._id === 'string' ? payload._id : ''
    const orderId = rawId.replace(/-\d+$/, '')
    const status = typeof payload.status === 'string' ? payload.status : 'UNKNOWN'
    if (!orderId) throw new MovingServiceError('VALIDATION_ERROR', 'Webhook payload is missing an order ID.')
    const eventHash = payloadHash(payload)
    const inserted = await this.repository.recordWebhook(eventHash, orderId, status, redactCredentials(payload))
    if (!inserted) return { accepted: true, duplicate: true, order_id: orderId }
    const currentStatus = await this.repository.getStoredOrderStatus(orderId)
    const stale = currentStatus ? !canApplyStatus(currentStatus, status) : false
    if (!stale) await this.repository.upsertOrder(orderId, status, redactCredentials(payload))
    return { accepted: true, duplicate: false, stale, order_id: orderId }
  }

  verifyWebhookAuthorization(headerValue: string | undefined) {
    if (!this.config.webhookSecret) {
      throw new MovingServiceError('CONFIGURATION_ERROR', 'AHAMOVE_WEBHOOK_SECRET is not configured.')
    }
    const expected = this.config.webhookAuthMode === 'api-key'
      ? this.config.webhookSecret
      : this.config.webhookAuthMode === 'bearer'
        ? `Bearer ${this.config.webhookSecret}`
        : `Basic ${this.config.webhookSecret}`
    const provided = Buffer.from(headerValue || '')
    const target = Buffer.from(expected)
    return provided.length === target.length && timingSafeEqual(provided, target)
  }

  private requireWrites() {
    if (!this.config.writeEnabled) {
      throw new MovingServiceError('WRITE_DISABLED', 'AhaMove write operations are disabled.')
    }
  }

  private async verifyApproval(
    approvalId: string,
    actionType: ApprovalRecord['actionType'],
    payload: Record<string, unknown>,
  ) {
    const approval = await this.repository.getApproval(approvalId)
    if (!approval) throw new MovingServiceError('APPROVAL_REQUIRED', 'A valid stored approval is required.')
    if (approval.actionType !== actionType || approval.payloadHash !== payloadHash(payload)) {
      throw new MovingServiceError('APPROVAL_INVALID', 'Approval does not match the requested action.')
    }
    if (approval.consumedAt) throw new MovingServiceError('APPROVAL_INVALID', 'Approval has already been consumed.')
    if (approval.expiresAt.getTime() <= Date.now()) throw new MovingServiceError('APPROVAL_EXPIRED', 'Approval has expired.')
  }
}

function canApplyStatus(current: string, incoming: string) {
  if (current === incoming) return true
  if (current === 'ACCEPTED' && incoming === 'ASSIGNING') return true
  if (terminalStatuses.has(current)) return false
  const currentRank = statusRank[current]
  const incomingRank = statusRank[incoming]
  if (currentRank === undefined || incomingRank === undefined) return false
  return incomingRank >= currentRank
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  }
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (Array.isArray(item.data)) return asRecordArray(item.data)
    return Object.values(item).filter(
      (nested): nested is Record<string, unknown> => Boolean(nested) && typeof nested === 'object' && !Array.isArray(nested),
    )
  }
  return []
}
