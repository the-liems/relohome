import type { MovingDatabasePool, MovingRuntimeConfig } from '@relohome/moving-service'
import { checkMovingReadiness, MovingService, MovingServiceError } from '@relohome/moving-service'
import Fastify from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { RegisterMovingApprovalRequestSchema } from '@relohome/contracts'

export function buildMovingApp(
  db: MovingDatabasePool,
  service: MovingService,
  config: MovingRuntimeConfig,
  options: { approvalToken?: string } = { approvalToken: process.env.MOVING_APPROVAL_TOKEN?.trim() },
) {
  if (options.approvalToken && options.approvalToken.length < 32) {
    throw new Error('MOVING_APPROVAL_TOKEN must contain at least 32 characters.')
  }
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.apikey', 'req.body.mobile', 'req.body.api_key'],
    },
    bodyLimit: 1_000_000,
    requestTimeout: 30_000,
    return503OnClosing: true,
  })

  app.get('/health', async () => {
    return { status: 'ok', service: 'lifeflow-moving-api', environment: config.environment,
      release: process.env.RELEASE_SHA || 'development' }
  })

  app.get('/ready', async (_request, reply) => {
    try { await checkMovingReadiness(db) }
    catch { return reply.status(503).send({ status: 'not_ready', dependency: 'database' }) }
    if (!config.webhookSecret || config.webhookSecret.startsWith('replace-with-')) {
      return reply.status(503).send({ status: 'not_ready', dependency: 'webhook_configuration' })
    }
    return { status: 'ok', service: 'lifeflow-moving-api' }
  })

  app.post('/v1/integrations/ahamove/webhooks/order-status', async (request, reply) => {
    const header = config.webhookAuthMode === 'api-key'
      ? request.headers.apikey
      : request.headers.authorization
    const value = Array.isArray(header) ? header[0] : header
    if (!service.verifyWebhookAuthorization(value)) {
      return reply.status(401).send({ code: 'NOT_AUTHORIZED', message: 'Invalid webhook credentials.' })
    }
    const payload = request.body
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Expected a JSON object.' })
    }
    return service.ingestWebhook(payload as Record<string, unknown>)
  })

  app.post('/v1/internal/moving/approvals', {
    onRequest: async (request, reply) => {
      if (!options.approvalToken) return reply.status(503).send({ code: 'APPROVAL_NOT_CONFIGURED' })
      const actual = Buffer.from(request.headers.authorization || '')
      const expected = Buffer.from(`Bearer ${options.approvalToken}`)
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return reply.status(401).send({ code: 'NOT_AUTHORIZED' })
      }
    },
  }, async (request, reply) => {
    const parsed = RegisterMovingApprovalRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid approval registration.' })
    const input = parsed.data
    const approvalId = await service.registerApproval({
      approvalId: input.approval_id, actionType: input.action_type, payload: input.payload,
      approvedBy: input.approved_by, expiresAt: new Date(input.expires_at),
    })
    return { approval_id: approvalId }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MovingServiceError) {
      const status = error.code === 'VALIDATION_ERROR' ? 400
        : error.code === 'APPROVAL_CONFLICT' ? 409
        : error.code === 'AUTHENTICATION_ERROR' ? 401
          : error.code === 'PROVIDER_NOT_FOUND' ? 404
            : error.retryable ? 503 : 422
      return reply.status(status).send({ code: error.code, message: error.message, retryable: error.retryable })
    }
    const statusCode = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
    if (statusCode === 400 || statusCode === 413 || statusCode === 415) {
      return reply.status(statusCode).send({ code: 'INVALID_REQUEST' })
    }
    app.log.error({ event: 'moving_api_error' })
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Unexpected moving API error.' })
  })

  app.addHook('onClose', async () => {
    await db.end()
  })
  return app
}
