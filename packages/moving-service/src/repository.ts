import type { MoveQuote } from '@relohome/contracts'
import type { QueryExecutor } from './database.js'
import { MovingServiceError } from './errors.js'

export interface StoredQuote {
  quote: MoveQuote
  request: Record<string, unknown>
}

export interface ApprovalRecord {
  approvalId: string
  actionType: 'create' | 'update' | 'cancel' | 'rate'
  payloadHash: string
  expiresAt: Date
  consumedAt: Date | null
}

export class MovingRepository {
  constructor(private readonly db: QueryExecutor) {}

  async saveQuote(quote: MoveQuote, request: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO moving.quotes (id, request_fingerprint, request_payload, quote_payload, expires_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [quote.quote_id, quote.request_fingerprint, JSON.stringify(request), JSON.stringify(quote), quote.expires_at],
    )
  }

  async getQuote(quoteId: string): Promise<StoredQuote | null> {
    const result = await this.db.query(
      `SELECT request_payload, quote_payload FROM moving.quotes WHERE id = $1`,
      [quoteId],
    )
    if (!result.rowCount) return null
    return { request: result.rows[0].request_payload, quote: result.rows[0].quote_payload }
  }

  async saveApproval(input: {
    approvalId: string
    actionType: ApprovalRecord['actionType']
    payloadHash: string
    approvedBy: string
    expiresAt: Date
  }) {
    const inserted = await this.db.query(
      `INSERT INTO moving.approvals (id, action_type, payload_hash, approved_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [input.approvalId, input.actionType, input.payloadHash, input.approvedBy, input.expiresAt],
    )
    if (inserted.rowCount) return true
    // Separate statement sees a concurrent INSERT once its unique-key lock releases.
    const existing = await this.db.query(
      'SELECT action_type, payload_hash, approved_by, expires_at FROM moving.approvals WHERE id=$1',
      [input.approvalId],
    )
    const row = existing.rows[0]
    if (!row || row.action_type !== input.actionType || row.payload_hash !== input.payloadHash
      || row.approved_by !== input.approvedBy
      || new Date(row.expires_at).getTime() !== input.expiresAt.getTime()) {
      throw new MovingServiceError('APPROVAL_CONFLICT', 'Approval id is already bound to different approval data.')
    }
    // Never extend the expiry or clear consumed_at on replay.
    return false
  }

  async getApproval(approvalId: string): Promise<ApprovalRecord | null> {
    const result = await this.db.query(
      `SELECT id, action_type, payload_hash, expires_at, consumed_at
       FROM moving.approvals WHERE id = $1`,
      [approvalId],
    )
    if (!result.rowCount) return null
    const row = result.rows[0]
    return {
      approvalId: row.id,
      actionType: row.action_type,
      payloadHash: row.payload_hash,
      expiresAt: new Date(row.expires_at),
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    }
  }

  async consumeApproval(approvalId: string) {
    const result = await this.db.query(
      `UPDATE moving.approvals SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()`,
      [approvalId],
    )
    return Boolean(result.rowCount)
  }

  async getAction(idempotencyKey: string) {
    const result = await this.db.query(
      `SELECT status, provider_order_id, response_payload
       FROM moving.order_actions WHERE idempotency_key = $1`,
      [idempotencyKey],
    )
    return result.rowCount ? result.rows[0] as Record<string, unknown> : null
  }

  async claimAction(idempotencyKey: string, workflowId: string, actionId: string, requestHash: string) {
    const result = await this.db.query(
      `INSERT INTO moving.order_actions (idempotency_key, workflow_id, action_id, request_hash, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT DO NOTHING`,
      [idempotencyKey, workflowId, actionId, requestHash],
    )
    return Boolean(result.rowCount)
  }

  async completeAction(idempotencyKey: string, providerOrderId: string, response: Record<string, unknown>) {
    await this.db.query(
      `UPDATE moving.order_actions
       SET status = 'completed', provider_order_id = $2, response_payload = $3::jsonb, completed_at = now()
       WHERE idempotency_key = $1`,
      [idempotencyKey, providerOrderId, JSON.stringify(response)],
    )
  }

  async failAction(idempotencyKey: string, errorCode: string) {
    await this.db.query(
      `UPDATE moving.order_actions SET status = 'failed', error_code = $2, completed_at = now()
       WHERE idempotency_key = $1`,
      [idempotencyKey, errorCode],
    )
  }

  async upsertOrder(orderId: string, status: string, payload: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO moving.orders (provider_order_id, status, order_payload, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (provider_order_id) DO UPDATE SET
         status = EXCLUDED.status,
         order_payload = EXCLUDED.order_payload,
         updated_at = now()`,
      [orderId, status, JSON.stringify(payload)],
    )
  }

  async getStoredOrderStatus(orderId: string): Promise<string | null> {
    const result = await this.db.query(
      `SELECT status FROM moving.orders WHERE provider_order_id = $1`,
      [orderId],
    )
    return result.rowCount ? String(result.rows[0].status) : null
  }

  async recordWebhook(eventHash: string, orderId: string, status: string, payload: Record<string, unknown>) {
    const result = await this.db.query(
      `INSERT INTO moving.webhook_events (event_hash, provider_order_id, status, event_payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (event_hash) DO NOTHING`,
      [eventHash, orderId, status, JSON.stringify(payload)],
    )
    return Boolean(result.rowCount)
  }
}
