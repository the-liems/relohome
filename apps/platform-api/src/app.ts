import cors from '@fastify/cors'
import {
  CoordinateSchema,
  HousingSearchRequestSchema,
  HousingMapRequestSchema,
  NearbyPlaceConstraintSchema,
  PlaceSearchRequestSchema,
  PlaceMapRequestSchema,
  ResolveLocationRequestSchema,
  RouteRequestSchema,
  EntityRouteRequestSchema,
  DeviceRouteRequestSchema,
  SearchAreasRequestSchema,
} from '@relohome/contracts'
import {
  HousingQueryService,
  boundedQueries,
  withinOperation,
  OperationError,
  LocationService,
  NotFoundError,
  PlaceService,
  QueryValidationError,
  RouteService,
  RouteEndpointService,
  RouteServiceError,
  type DatabasePool,
  type ApplicationRuntimeConfig,
} from '@relohome/housing-query'
import Fastify, { LogController, type FastifyReply, type FastifyRequest } from 'fastify'
import { z, ZodError } from 'zod'
import { ManagementError, registerHousingManagement } from './housing-management.js'
import { registerHousingWorkspace } from './housing-workspace.js'
import { registerHousingReviews } from './housing-reviews.js'
import { registerHousingActivity } from './housing-activity.js'
import { registerHousingHandoff } from './housing-handoff.js'
import { registerHousingRevenue } from './housing-revenue.js'

const ListingParamsSchema = z.object({ listingId: z.uuid() })
const PlaceParamsSchema = z.object({ placeId: z.uuid() })
const NearbyRequestSchema = z.object({
  origin: CoordinateSchema,
  constraints: z.array(NearbyPlaceConstraintSchema).min(1).max(10),
})

/** One access line per request, written at completion: 5xx at error, healthy probes silent. */
class AccessLog extends LogController {
  override incomingRequest () {}

  override routeNotFound () {}

  override requestCompleted (error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply) {
    // Container probes run every 15 s; only unhealthy results are worth a line.
    if (!error && request.routeOptions.url === '/health' && reply.statusCode < 400) return
    const line = { req: request, res: reply, err: error ?? undefined, responseTime: reply.elapsedTime }
    if (error || reply.statusCode >= 500) reply.log.error(line, 'request completed')
    else reply.log.info(line, 'request completed')
  }
}

export function buildApp(pool: DatabasePool, config: ApplicationRuntimeConfig) {
  const app = Fastify({ logger: true, logController: new AccessLog() })
  const routeService = new RouteService(config.osrmUrls, config.publicDrivingOsrmUrl)
  const queries = boundedQueries(pool)
  const entityRouteService = new RouteEndpointService(queries, routeService)
  const housingService = new HousingQueryService(queries, routeService, config)
  const locationService = new LocationService(queries)
  const placeService = new PlaceService(queries)
  registerHousingManagement(app, pool)
  registerHousingWorkspace(app, pool)
  registerHousingReviews(app, pool)
  registerHousingHandoff(app, pool)
  registerHousingActivity(app, pool)
  registerHousingRevenue(app, pool)

  void app.register(cors, {
    origin: [/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/],
    methods: ['GET', 'POST', 'OPTIONS'],
  })

  app.get('/health', async (_request, reply) => {
    const result = await pool.query(`SELECT postgis_version() AS postgis_version,
      to_regclass('housing.managed_listing_visibility') IS NOT NULL
      AND to_regclass('housing.listing_reviews') IS NOT NULL
      AND to_regclass('housing.rent_payment_reports') IS NOT NULL
      AND to_regclass('housing.activity_events') IS NOT NULL
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='housing'
        AND table_name='reviews' AND column_name='is_anonymous') AS schema_ready`)
    if (result.rows[0]?.schema_ready !== true) return reply.status(503).send({ status: 'migration_required' })
    return { status: 'ok', postgis: result.rows[0].postgis_version }
  })

  app.post('/v1/housing/search', async request => {
    return housingService.search(HousingSearchRequestSchema.parse(request.body))
  })

  app.post('/v1/housing/map', async request => {
    return housingService.map(HousingMapRequestSchema.parse(request.body))
  })

  app.get('/v1/housing/:listingId', async request => {
    const { listingId } = ListingParamsSchema.parse(request.params)
    return housingService.get(listingId)
  })

  app.post('/v1/places/search', async request => {
    return placeService.search(PlaceSearchRequestSchema.parse(request.body))
  })

  app.post('/v1/places/map', async request => {
    return placeService.map(PlaceMapRequestSchema.parse(request.body))
  })

  app.post('/v1/areas/search', async request => {
    return locationService.searchAreas(SearchAreasRequestSchema.parse(request.body))
  })

  app.post('/v1/locations/resolve', async request => {
    return locationService.resolve(ResolveLocationRequestSchema.parse(request.body))
  })

  app.get('/v1/places/:placeId', async request => {
    const { placeId } = PlaceParamsSchema.parse(request.params)
    const place = await placeService.get(placeId)
    if (!place) throw new NotFoundError(`Place not found: ${placeId}`)
    return place
  })

  app.post('/v1/places/nearby', async request => {
    const input = NearbyRequestSchema.parse(request.body)
    return {
      results: await placeService.findNearby(input.origin, input.constraints),
    }
  })

  app.post('/v1/routes', async request => {
    return routeService.calculate(RouteRequestSchema.parse(request.body))
  })

  app.post('/v1/routes/entities', async request => {
    return entityRouteService.calculate(EntityRouteRequestSchema.parse(request.body))
  })

  app.post('/v1/routes/device', async (request, reply) => {
    const controller = new AbortController()
    const disconnected = () => {
      if (!reply.raw.writableFinished) controller.abort()
    }
    reply.raw.once('close', disconnected)
    try {
      const input = DeviceRouteRequestSchema.parse(request.body)
      return await withinOperation(() => entityRouteService.calculateDevice(input), controller.signal, 20_000)
    } finally {
      reply.raw.removeListener('close', disconnected)
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ManagementError) {
      return reply.status(error.status).send({
        code: error.code,
        message: error.message,
        fields: error.fields,
      })
    }
    if (error instanceof OperationError) {
      return reply.status(error.code === 'TIMEOUT' ? 504 : error.code === 'CANCELLED' ? 408 : 503).send({
        code: error.code,
        message: error.message,
        retryable: error.code !== 'CANCELLED',
      })
    }
    if (error instanceof ZodError || error instanceof QueryValidationError) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: error.message,
        issues: error instanceof ZodError ? error.issues : undefined,
      })
    }
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ code: error.code, message: error.message })
    }
    if (error instanceof RouteServiceError) {
      const status = error.code === 'OSRM_OFFLINE' ? 503 : 422
      return reply.status(status).send({ code: error.code, message: error.message })
    }
    const databaseError = error as { code?: string; constraint?: string }
    if (databaseError.code === '23P01' && databaseError.constraint === 'rent_periods_no_overlap')
      return reply.status(409).send({
        code: 'rent_period_overlap',
        message: 'Khoảng thuê trùng với kỳ thuê đã ghi nhận. Hãy kiểm tra ngày bắt đầu trước khi xác nhận.',
      })
    if (['40001', '40P01', '23505'].includes((error as { code?: string }).code || ''))
      return reply.status(409).send({
        code: 'revision_conflict',
        message: 'Dữ liệu đã thay đổi. Hãy tải lại và thử lại.',
      })
    app.log.error(error)
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' })
  })

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return app
}
