import type { MovingDatabasePool, MovingRuntimeConfig } from '@lifeflow/moving-service'
import { MovingService, MovingServiceError } from '@lifeflow/moving-service'
import Fastify from 'fastify'

export function buildMovingApp(
  db: MovingDatabasePool,
  service: MovingService,
  config: MovingRuntimeConfig,
) {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.apikey', 'req.body.mobile', 'req.body.api_key'],
    },
    bodyLimit: 1_000_000,
  })

  app.get('/health', async () => {
    await db.query('SELECT 1')
    return { status: 'ok', service: 'lifeflow-moving', environment: config.environment }
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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MovingServiceError) {
      const status = error.code === 'VALIDATION_ERROR' ? 400
        : error.code === 'AUTHENTICATION_ERROR' ? 401
          : error.code === 'PROVIDER_NOT_FOUND' ? 404
            : error.retryable ? 503 : 422
      return reply.status(status).send({ code: error.code, message: error.message, retryable: error.retryable })
    }
    app.log.error(error)
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Unexpected moving API error.' })
  })

  app.addHook('onClose', async () => {
    await db.end()
  })
  return app
}
