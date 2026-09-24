import {
  CoordinateSchema,
  HousingDetailSchema,
  HousingSearchRequestSchema,
  HousingSearchResponseSchema,
  NearbyPlaceConstraintSchema,
  NearbyPlaceMatchSchema,
  PlaceSchema,
  PlaceSearchRequestSchema,
  ResolveLocationRequestSchema,
  ResolveLocationResponseSchema,
  RouteRequestSchema,
  RouteResultSchema,
  SearchAreasRequestSchema,
  SearchAreasResponseSchema,
} from '@lifeflow/contracts'
import {
  HousingQueryService,
  LocationService,
  NotFoundError,
  PlaceService,
  QueryValidationError,
  RouteService,
  RouteServiceError,
  type QueryExecutor,
} from '@lifeflow/housing-query'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

interface Dependencies {
  pool: QueryExecutor
  housingService: HousingQueryService
  locationService: LocationService
  placeService: PlaceService
  routeService: RouteService
}

export function createLifeFlowMcpServer(dependencies: Dependencies) {
  const server = new McpServer({
    name: 'lifeflow-housing-query',
    version: '0.1.0',
  })

  server.registerTool(
    'search_housing',
    {
      title: 'Search housing',
      description:
        'Return factual housing listings that satisfy explicit hard constraints. This tool does not rank or recommend listings.',
      inputSchema: HousingSearchRequestSchema,
      outputSchema: HousingSearchResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'search_housing', async (input) => dependencies.housingService.search(input)),
  )

  server.registerTool(
    'get_housing',
    {
      title: 'Get housing listing',
      description: 'Get factual details for one canonical housing listing ID.',
      inputSchema: z.object({ listing_id: z.uuid() }),
      outputSchema: HousingDetailSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'get_housing', async ({ listing_id }) =>
      dependencies.housingService.get(listing_id),
    ),
  )

  server.registerTool(
    'search_places',
    {
      title: 'Search places',
      description: 'Search canonical places using text, category and spatial constraints.',
      inputSchema: PlaceSearchRequestSchema,
      outputSchema: z.object({
        results: z.array(PlaceSchema),
        next_cursor: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'search_places', async (input) => dependencies.placeService.search(input)),
  )

  server.registerTool(
    'search_areas',
    {
      title: 'Search administrative areas',
      description:
        'Search locally owned administrative boundaries by accent-insensitive name and return canonical area IDs, parents, centers and bounding boxes.',
      inputSchema: SearchAreasRequestSchema,
      outputSchema: SearchAreasResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'search_areas', async (input) =>
      dependencies.locationService.searchAreas(input),
    ),
  )

  server.registerTool(
    'resolve_location',
    {
      title: 'Resolve location',
      description:
        'Resolve a location name against local canonical places and administrative areas, returning multiple factual candidates when the name is ambiguous.',
      inputSchema: ResolveLocationRequestSchema,
      outputSchema: ResolveLocationResponseSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'resolve_location', async (input) =>
      dependencies.locationService.resolve(input),
    ),
  )

  server.registerTool(
    'get_place',
    {
      title: 'Get place',
      description: 'Get one canonical place by ID.',
      inputSchema: z.object({ place_id: z.uuid() }),
      outputSchema: PlaceSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'get_place', async ({ place_id }) => {
      const place = await dependencies.placeService.get(place_id)
      if (!place) throw new NotFoundError(`Place not found: ${place_id}`)
      return place
    }),
  )

  server.registerTool(
    'find_nearby_places',
    {
      title: 'Find nearby places',
      description: 'Return the nearest factual place matching each category and distance constraint.',
      inputSchema: z.object({
        origin: CoordinateSchema,
        constraints: z.array(NearbyPlaceConstraintSchema).min(1).max(10),
      }),
      outputSchema: z.object({ results: z.array(NearbyPlaceMatchSchema) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    audited(dependencies.pool, 'find_nearby_places', async ({ origin, constraints }) => ({
      results: await dependencies.placeService.findNearby(origin, constraints),
    })),
  )

  server.registerTool(
    'calculate_route',
    {
      title: 'Calculate route',
      description: 'Calculate a factual OSRM driving, motorcycle or walking route, distance and duration.',
      inputSchema: RouteRequestSchema,
      outputSchema: RouteResultSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    audited(dependencies.pool, 'calculate_route', async (input) => dependencies.routeService.calculate(input)),
  )

  return server
}

function audited<Input, Output extends Record<string, unknown>>(
  pool: QueryExecutor,
  toolName: string,
  handler: (input: Input) => Promise<Output>,
) {
  return async (input: Input) => {
    const started = performance.now()
    try {
      const output = await handler(input)
      await writeAudit(pool, toolName, input, 'success', performance.now() - started)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(output) }],
        structuredContent: output,
      }
    } catch (error) {
      const code = errorCode(error)
      await writeAudit(pool, toolName, input, 'error', performance.now() - started, code)
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ code, message: error instanceof Error ? error.message : 'Unknown error' }),
          },
        ],
      }
    }
  }
}

async function writeAudit(
  pool: QueryExecutor,
  toolName: string,
  input: unknown,
  status: 'success' | 'error',
  durationMs: number,
  errorCodeValue?: string,
) {
  const keys = input && typeof input === 'object' ? Object.keys(input) : []
  try {
    await pool.query(
      `INSERT INTO audit.tool_calls (
         tool_name, input_summary, result_status, duration_ms, error_code
       ) VALUES ($1, $2::jsonb, $3, $4, $5)`,
      [toolName, JSON.stringify({ keys }), status, Math.max(0, Math.round(durationMs)), errorCodeValue || null],
    )
  } catch (error) {
    console.error('Failed to write MCP audit event:', error)
  }
}

function errorCode(error: unknown) {
  if (error instanceof QueryValidationError) return error.code
  if (error instanceof NotFoundError) return error.code
  if (error instanceof RouteServiceError) return error.code
  if (error instanceof z.ZodError) return 'VALIDATION_ERROR'
  return 'INTERNAL_ERROR'
}
