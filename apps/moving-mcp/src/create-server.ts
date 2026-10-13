import {
  CancelMoveOrderRequestSchema,
  CreateMoveOrderRequestSchema,
  EstimateMoveRequestSchema,
  MoveQuoteSchema,
  MovingCitySchema,
  MovingOrderSchema,
  MovingServiceOptionSchema,
  MovingToolMetaSchema,
  RateMoveDriverRequestSchema,
  UpdateMoveOrderRequestSchema,
} from '@relohome/contracts'
import { auditedTool, type ToolErrorShape } from '@relohome/mcp-core'
import { MovingService, MovingServiceError, requestId, type QueryExecutor } from '@relohome/moving-service'
import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

interface Dependencies {
  db: QueryExecutor
  movingService: MovingService
  environment: 'staging' | 'production'
  access?: 'read' | 'write'
}

const metadata = (environment: 'staging' | 'production') => ({
  contract_version: '1.0.0' as const,
  provider: 'ahamove' as const,
  environment,
  request_id: requestId(),
  observed_at: new Date().toISOString(),
})

const ReadAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
const CreateAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
const UpdateAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
const DestructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }

export function createMovingMcpServer(dependencies: Dependencies) {
  const server = new McpServer({ name: 'lifeflow-moving', version: '0.1.0' })
  const wrap = <Input, Output extends Record<string, unknown>>(
    name: string,
    handler: (input: Input) => Promise<Output>,
  ) => auditedTool(dependencies.db, name, handler, classifyError)

  server.registerTool('list_service_areas', {
    title: 'List AhaMove service areas',
    description: 'List factual cities currently published by AhaMove. Does not create or change an order.',
    inputSchema: z.object({ country_id: z.string().trim().length(2).default('VN') }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, cities: z.array(MovingCitySchema) }),
    annotations: ReadAnnotations,
  }, wrap('list_service_areas', async ({ country_id }) => ({
    meta: metadata(dependencies.environment),
    cities: await dependencies.movingService.listCities(country_id),
  })))

  server.registerTool('list_moving_services', {
    title: 'List moving services',
    description: 'List current AhaMove vehicle/services and special requests by city or pickup coordinate.',
    inputSchema: z.object({
      city_id: z.string().trim().min(1).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      delivery_type: z.enum(['INSTANT', 'TRUCK']).optional(),
    }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, services: z.array(MovingServiceOptionSchema) }),
    annotations: ReadAnnotations,
  }, wrap('list_moving_services', async (input) => ({
    meta: metadata(dependencies.environment),
    services: await dependencies.movingService.listServices(input),
  })))

  server.registerTool('get_moving_service', {
    title: 'Get moving service details',
    description: 'Get current factual limits, descriptions and special requests for one AhaMove service ID.',
    inputSchema: z.object({ service_id: z.string().trim().min(1) }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, service: MovingServiceOptionSchema }),
    annotations: ReadAnnotations,
  }, wrap('get_moving_service', async ({ service_id }) => ({
    meta: metadata(dependencies.environment),
    service: await dependencies.movingService.getService(service_id),
  })))

  server.registerTool('estimate_move', {
    title: 'Estimate a move',
    description: 'Estimate distance and complete fee breakdown for one or more AhaMove services. The quote is time limited and is not an order.',
    inputSchema: EstimateMoveRequestSchema,
    outputSchema: z.object({ meta: MovingToolMetaSchema, quote: MoveQuoteSchema }),
    annotations: ReadAnnotations,
  }, wrap('estimate_move', async (input) => ({
    meta: metadata(dependencies.environment),
    quote: await dependencies.movingService.estimate(input),
  })))

  server.registerTool('get_move_order', {
    title: 'Get move order',
    description: 'Get full factual order, pickup/delivery status, fees, driver and timestamps from AhaMove.',
    inputSchema: z.object({ order_id: z.string().trim().min(1), include_tracking_link: z.boolean().default(false) }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, order: MovingOrderSchema }),
    annotations: ReadAnnotations,
  }, wrap('get_move_order', async ({ order_id, include_tracking_link }) => ({
    meta: metadata(dependencies.environment),
    order: await dependencies.movingService.getOrder(order_id, include_tracking_link),
  })))

  server.registerTool('get_move_orders', {
    title: 'Get multiple move orders',
    description: 'Get factual details for up to 100 AhaMove order IDs.',
    inputSchema: z.object({ order_ids: z.array(z.string().trim().min(1)).min(1).max(100) }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, orders: z.array(MovingOrderSchema) }),
    annotations: ReadAnnotations,
  }, wrap('get_move_orders', async ({ order_ids }) => ({
    meta: metadata(dependencies.environment),
    orders: await dependencies.movingService.getOrders(order_ids),
  })))

  server.registerTool('find_move_orders_by_tracking_number', {
    title: 'Find move orders by partner tracking number',
    description: 'Find AhaMove orders associated with a partner tracking number and optional epoch time range.',
    inputSchema: z.object({
      tracking_number: z.string().trim().min(1),
      from_time: z.number().int().nonnegative().optional(),
      to_time: z.number().int().nonnegative().optional(),
    }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, orders: z.array(MovingOrderSchema) }),
    annotations: ReadAnnotations,
  }, wrap('find_move_orders_by_tracking_number', async ({ tracking_number, from_time, to_time }) => ({
    meta: metadata(dependencies.environment),
    orders: await dependencies.movingService.findOrdersByTrackingNumber(tracking_number, from_time, to_time),
  })))

  server.registerTool('get_move_tracking_link', {
    title: 'Get move tracking link',
    description: 'Get the provider tracking URL for one AhaMove order.',
    inputSchema: z.object({ order_id: z.string().trim().min(1) }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, shared_link: z.url() }),
    annotations: ReadAnnotations,
  }, wrap('get_move_tracking_link', async ({ order_id }) => ({
    meta: metadata(dependencies.environment),
    ...(await dependencies.movingService.getTrackingLink(order_id)),
  })))

  server.registerTool('get_move_order_events', {
    title: 'Get AhaMove callback history',
    description: 'Get provider callback delivery history for a partner tracking number.',
    inputSchema: z.object({ tracking_number: z.string().trim().min(1) }),
    outputSchema: z.object({ meta: MovingToolMetaSchema, callback: z.record(z.string(), z.unknown()) }),
    annotations: ReadAnnotations,
  }, wrap('get_move_order_events', async ({ tracking_number }) => ({
    meta: metadata(dependencies.environment),
    callback: await dependencies.movingService.getCallbackLogs(tracking_number),
  })))

  // The read credential gets an actual read-only server, including tools/list.
  // A client allowlist alone is not authorization.
  if (dependencies.access !== 'write') return server

  server.registerTool('create_move_order', {
    title: 'Create an approved move order',
    description: 'Create exactly one AhaMove order from a non-expired quote. Requires a server-stored approval bound to the selected quote and cost.',
    inputSchema: CreateMoveOrderRequestSchema,
    outputSchema: z.object({ meta: MovingToolMetaSchema, order: MovingOrderSchema }),
    annotations: CreateAnnotations,
  }, wrap('create_move_order', async (input) => ({
    meta: metadata(dependencies.environment),
    order: await dependencies.movingService.createOrder(input),
  })))

  server.registerTool('update_move_order', {
    title: 'Update an approved move order',
    description: 'Update fields allowed by AhaMove for an eligible order. Requires a matching server-stored approval.',
    inputSchema: UpdateMoveOrderRequestSchema,
    outputSchema: z.object({ meta: MovingToolMetaSchema, order: MovingOrderSchema }),
    annotations: UpdateAnnotations,
  }, wrap('update_move_order', async (input) => ({
    meta: metadata(dependencies.environment),
    order: await dependencies.movingService.updateOrder(input),
  })))

  server.registerTool('cancel_move_order', {
    title: 'Cancel an approved move order',
    description: 'Cancel an eligible AhaMove order by order ID or tracking number. Requires a matching server-stored approval.',
    inputSchema: CancelMoveOrderRequestSchema,
    outputSchema: z.object({ meta: MovingToolMetaSchema, order: MovingOrderSchema }),
    annotations: DestructiveAnnotations,
  }, wrap('cancel_move_order', async (input) => ({
    meta: metadata(dependencies.environment),
    order: await dependencies.movingService.cancelOrder(input),
  })))

  server.registerTool('rate_move_driver', {
    title: 'Rate a move driver',
    description: 'Rate the driver of a completed order. Disabled by default and requires a matching human approval.',
    inputSchema: RateMoveDriverRequestSchema,
    outputSchema: z.object({ meta: MovingToolMetaSchema, rated: z.boolean(), order_id: z.string() }),
    annotations: UpdateAnnotations,
  }, wrap('rate_move_driver', async (input) => ({
    meta: metadata(dependencies.environment),
    ...(await dependencies.movingService.rateDriver(input)),
  })))

  return server
}

function classifyError(error: unknown): ToolErrorShape {
  if (error instanceof MovingServiceError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION_ERROR', message: error.message, retryable: false }
  }
  return { code: 'INTERNAL_ERROR', message: 'Unexpected moving service error.', retryable: false }
}
