import cors from '@fastify/cors'
import {
  CoordinateSchema,
  HousingSearchRequestSchema,
  NearbyPlaceConstraintSchema,
  PlaceSearchRequestSchema,
  ResolveLocationRequestSchema,
  RouteRequestSchema,
  SearchAreasRequestSchema,
} from '@lifeflow/contracts'
import {
  HousingQueryService,
  LocationService,
  NotFoundError,
  PlaceService,
  QueryValidationError,
  RouteService,
  RouteServiceError,
  type DatabasePool,
  type RuntimeConfig,
} from '@lifeflow/housing-query'
import Fastify from 'fastify'
import { z, ZodError } from 'zod'

const ListingParamsSchema = z.object({ listingId: z.uuid() })
const PlaceParamsSchema = z.object({ placeId: z.uuid() })
const NearbyRequestSchema = z.object({
  origin: CoordinateSchema,
  constraints: z.array(NearbyPlaceConstraintSchema).min(1).max(10),
})

export function buildApp(pool: DatabasePool, config: RuntimeConfig) {
  const app = Fastify({ logger: true })
  const routeService = new RouteService(config.osrmUrls)
  const housingService = new HousingQueryService(pool, routeService, config)
  const locationService = new LocationService(pool)
  const placeService = new PlaceService(pool)

  void app.register(cors, {
    origin: [/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/],
    methods: ['GET', 'POST', 'OPTIONS'],
  })

  app.get('/health', async () => {
    const result = await pool.query('SELECT postgis_version() AS postgis_version')
    return { status: 'ok', postgis: result.rows[0]?.postgis_version }
  })

  app.post('/v1/housing/search', async (request) => {
    return housingService.search(HousingSearchRequestSchema.parse(request.body))
  })

  app.get('/v1/housing/:listingId', async (request) => {
    const { listingId } = ListingParamsSchema.parse(request.params)
    return housingService.get(listingId)
  })

  app.post('/v1/places/search', async (request) => {
    return placeService.search(PlaceSearchRequestSchema.parse(request.body))
  })

  app.post('/v1/areas/search', async (request) => {
    return locationService.searchAreas(SearchAreasRequestSchema.parse(request.body))
  })

  app.post('/v1/locations/resolve', async (request) => {
    return locationService.resolve(ResolveLocationRequestSchema.parse(request.body))
  })

  app.get('/v1/places/:placeId', async (request) => {
    const { placeId } = PlaceParamsSchema.parse(request.params)
    const place = await placeService.get(placeId)
    if (!place) throw new NotFoundError(`Place not found: ${placeId}`)
    return place
  })

  app.post('/v1/places/nearby', async (request) => {
    const input = NearbyRequestSchema.parse(request.body)
    return { results: await placeService.findNearby(input.origin, input.constraints) }
  })

  app.post('/v1/routes', async (request) => {
    return routeService.calculate(RouteRequestSchema.parse(request.body))
  })

  app.setErrorHandler((error, _request, reply) => {
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
    app.log.error(error)
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' })
  })

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return app
}
