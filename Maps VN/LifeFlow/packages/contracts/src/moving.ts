import { z } from 'zod'
import { CoordinateSchema } from './common.js'

export const MovingContractVersionSchema = z.literal('1.0.0')
export const MovingEnvironmentSchema = z.enum(['staging', 'production'])
export const MovingPaymentMethodSchema = z.enum(['CASH', 'CASH_BY_RECIPIENT', 'BALANCE'])

export const MovingPointSchema = z.object({
  address: z.string().trim().min(3).max(500),
  short_address: z.string().trim().min(1).max(250).optional(),
  coordinate: CoordinateSchema,
  name: z.string().trim().min(1).max(150),
  mobile: z.string().trim().regex(/^\+?\d{9,15}$/),
  remarks: z.string().trim().max(500).optional(),
  tracking_number: z.string().trim().min(1).max(100).optional(),
  cod: z.number().int().nonnegative().optional(),
  item_value: z.number().int().nonnegative().optional(),
  building: z.string().trim().max(200).optional(),
  apartment_or_floor: z.string().trim().max(100).optional(),
  require_pod: z.boolean().optional(),
  require_verification: z.boolean().optional(),
})

export const MovingItemSchema = z.object({
  item_id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(10_000),
  unit_price: z.number().int().nonnegative(),
})

export const MovingPackageSchema = z.object({
  weight_kg: z.number().positive().max(100_000),
  length_cm: z.number().positive().max(10_000).optional(),
  width_cm: z.number().positive().max(10_000).optional(),
  height_cm: z.number().positive().max(10_000).optional(),
  description: z.string().trim().min(1).max(500).optional(),
})

export const MovingSpecialRequestSchema = z.object({
  request_id: z.string().trim().min(1).max(150),
  quantity: z.number().int().positive().max(1_000).optional(),
  tier_code: z.string().trim().min(1).max(100).optional(),
  option_id: z.string().trim().min(1).max(150).optional(),
})

export const MovingServiceSelectionSchema = z.object({
  service_id: z.string().trim().min(1).max(150),
  requests: z.array(MovingSpecialRequestSchema).max(50).default([]),
})

export const MovingOrderDraftSchema = z.object({
  order_time: z.number().nonnegative().default(0),
  pickup: MovingPointSchema,
  destinations: z.array(MovingPointSchema).min(1).max(50),
  payment_method: MovingPaymentMethodSchema,
  remarks: z.string().trim().max(1_000).optional(),
  promo_code: z.string().trim().min(1).max(100).optional(),
  items: z.array(MovingItemSchema).max(500).optional(),
  packages: z.array(MovingPackageSchema).max(100).optional(),
  route_optimized: z.boolean().default(false),
  idle_until: z.number().nonnegative().optional(),
}).superRefine((draft, context) => {
  if (draft.order_time === 0 && draft.idle_until !== undefined) {
    context.addIssue({ code: 'custom', message: 'idle_until requires a scheduled order_time.', path: ['idle_until'] })
  }
  if (draft.idle_until !== undefined && draft.idle_until !== draft.order_time) {
    context.addIssue({ code: 'custom', message: 'idle_until must equal order_time.', path: ['idle_until'] })
  }
  const trackingNumbers = draft.destinations
    .map((point) => point.tracking_number)
    .filter((value): value is string => Boolean(value))
  if (new Set(trackingNumbers).size !== trackingNumbers.length) {
    context.addIssue({ code: 'custom', message: 'Destination tracking numbers must be unique.', path: ['destinations'] })
  }
})

export const EstimateMoveRequestSchema = z.object({
  draft: MovingOrderDraftSchema,
  services: z.array(MovingServiceSelectionSchema).min(1).max(20),
})

export const MovingFeeBreakdownSchema = z.object({
  currency: z.string().min(3).max(3),
  distance_km: z.number().nonnegative().nullable(),
  duration_seconds: z.number().nonnegative().nullable(),
  distance_price: z.number().nonnegative().nullable(),
  stop_point_price: z.number().nonnegative().nullable(),
  special_request_price: z.number().nonnegative().nullable(),
  cod_commission_price: z.number().nonnegative().nullable(),
  voucher_discount: z.number().nonnegative().nullable(),
  subtotal_price: z.number().nonnegative().nullable(),
  total_price: z.number().nonnegative(),
  total_pay: z.number().nonnegative().nullable(),
})

export const MovingQuoteOptionSchema = z.object({
  service_id: z.string().min(1),
  service_name: z.string().nullable(),
  fee: MovingFeeBreakdownSchema,
  requests: z.array(z.record(z.string(), z.unknown())),
  provider_data: z.record(z.string(), z.unknown()),
})

export const MoveQuoteSchema = z.object({
  contract_version: MovingContractVersionSchema,
  quote_id: z.uuid(),
  provider: z.literal('ahamove'),
  environment: MovingEnvironmentSchema,
  request_fingerprint: z.string().length(64),
  observed_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  options: z.array(MovingQuoteOptionSchema),
  warnings: z.array(z.string()),
})

export const CreateMoveOrderRequestSchema = z.object({
  quote_id: z.uuid(),
  service_id: z.string().trim().min(1).max(150),
  approval_id: z.uuid(),
  workflow_id: z.string().trim().min(1).max(200),
  action_id: z.string().trim().min(1).max(200),
})

export const UpdateMoveOrderRequestSchema = z.object({
  order_id: z.string().trim().min(1).max(100),
  path_index: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(150).optional(),
  mobile: z.string().trim().regex(/^\+?\d{9,15}$/).optional(),
  remarks: z.string().trim().max(500).optional(),
  cod: z.number().int().nonnegative().optional(),
  address_info: z.object({
    address: z.string().trim().min(3).max(500),
    coordinate: CoordinateSchema.optional(),
  }).optional(),
  approval_id: z.uuid(),
})

export const CancelMoveOrderRequestSchema = z.object({
  order_id: z.string().trim().min(1).max(100).optional(),
  tracking_number: z.string().trim().min(1).max(100).optional(),
  comment: z.string().trim().min(1).max(500),
  approval_id: z.uuid(),
}).refine((value) => Boolean(value.order_id) !== Boolean(value.tracking_number), {
  message: 'Provide exactly one of order_id or tracking_number.',
})

export const RateMoveDriverRequestSchema = z.object({
  order_id: z.string().trim().min(1).max(100),
  rated_by: z.enum(['user', 'receiver']),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
  approval_id: z.uuid(),
})

// Canonical approval payloads are shared by the internal API and the write tools.
export const MovingApprovalPayloadSchema = z.union([
  CreateMoveOrderRequestSchema.omit({ approval_id: true }).extend({
    action: z.literal('create'),
    quote_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    total_price: z.number().nonnegative(),
  }).strict(),
  UpdateMoveOrderRequestSchema.omit({ approval_id: true }).extend({ action: z.literal('update') }).strict(),
  z.object({
    action: z.literal('cancel'),
    order_id: z.string().trim().min(1).max(100).optional(),
    tracking_number: z.string().trim().min(1).max(100).optional(),
    comment: z.string().trim().min(1).max(500),
  }).strict().refine((value) => Boolean(value.order_id) !== Boolean(value.tracking_number), {
    message: 'Provide exactly one order reference.',
  }),
  RateMoveDriverRequestSchema.omit({ approval_id: true }).extend({ action: z.literal('rate') }).strict(),
])

export const RegisterMovingApprovalRequestSchema = z.object({
  approval_id: z.uuid(),
  action_type: z.enum(['create', 'update', 'cancel', 'rate']),
  payload: MovingApprovalPayloadSchema,
  approved_by: z.string().trim().min(1).max(200),
  expires_at: z.iso.datetime({ offset: true }),
}).strict().refine((value) => value.action_type === value.payload.action, {
  message: 'Approval action_type must match payload.action.',
})

export const MovingOrderSchema = z.object({
  contract_version: MovingContractVersionSchema,
  provider: z.literal('ahamove'),
  environment: MovingEnvironmentSchema,
  order_id: z.string().min(1),
  status: z.string().min(1),
  sub_status: z.string().nullable(),
  service_id: z.string().nullable(),
  city_id: z.string().nullable(),
  distance_km: z.number().nonnegative().nullable(),
  fee: MovingFeeBreakdownSchema.nullable(),
  path: z.array(z.record(z.string(), z.unknown())),
  supplier: z.object({ id: z.string().nullable(), name: z.string().nullable() }).nullable(),
  timestamps: z.record(z.string(), z.number().nullable()),
  shared_link: z.url().nullable(),
  provider_data: z.record(z.string(), z.unknown()),
})

export const MovingCitySchema = z.object({
  city_id: z.string().min(1),
  name: z.string().min(1),
  local_name: z.string().nullable(),
  country_id: z.string().min(1),
  provider_data: z.record(z.string(), z.unknown()),
})

export const MovingServiceOptionSchema = z.object({
  service_id: z.string().min(1),
  city_id: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  delivery_type: z.string().nullable(),
  currency: z.string().nullable(),
  cod_limit: z.number().nonnegative().nullable(),
  requests: z.array(z.record(z.string(), z.unknown())),
  provider_data: z.record(z.string(), z.unknown()),
})

export const MovingToolMetaSchema = z.object({
  contract_version: MovingContractVersionSchema,
  provider: z.literal('ahamove'),
  environment: MovingEnvironmentSchema,
  request_id: z.uuid(),
  observed_at: z.iso.datetime(),
})

export type MovingPoint = z.infer<typeof MovingPointSchema>
export type MovingOrderDraft = z.infer<typeof MovingOrderDraftSchema>
export type EstimateMoveRequest = z.infer<typeof EstimateMoveRequestSchema>
export type MoveQuote = z.infer<typeof MoveQuoteSchema>
export type CreateMoveOrderRequest = z.infer<typeof CreateMoveOrderRequestSchema>
export type UpdateMoveOrderRequest = z.infer<typeof UpdateMoveOrderRequestSchema>
export type CancelMoveOrderRequest = z.infer<typeof CancelMoveOrderRequestSchema>
export type RateMoveDriverRequest = z.infer<typeof RateMoveDriverRequestSchema>
export type MovingOrder = z.infer<typeof MovingOrderSchema>
