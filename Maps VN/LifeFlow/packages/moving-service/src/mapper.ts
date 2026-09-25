import {
  MovingCitySchema,
  MovingOrderSchema,
  MovingServiceOptionSchema,
  type MovingOrderDraft,
} from '@lifeflow/contracts'
import { MovingServiceError } from './errors.js'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function numberOrNull(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function stringOrNull(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

export function toAhaMovePath(draft: MovingOrderDraft) {
  return [draft.pickup, ...draft.destinations].map((point) => ({
    address: point.address,
    short_address: point.short_address,
    lat: point.coordinate.lat,
    lng: point.coordinate.lng,
    name: point.name,
    mobile: point.mobile,
    remarks: point.remarks,
    tracking_number: point.tracking_number,
    cod: point.cod,
    item_value: point.item_value,
    building: point.building,
    apt_number: point.apartment_or_floor,
    require_pod: point.require_pod,
    require_verification: point.require_verification,
  }))
}

export function toAhaMoveOrderBase(draft: MovingOrderDraft) {
  return {
    order_time: draft.order_time,
    path: toAhaMovePath(draft),
    payment_method: draft.payment_method,
    remarks: draft.remarks,
    promo_code: draft.promo_code,
    idle_until: draft.idle_until,
    route_optimized: draft.route_optimized,
    items: draft.items?.map((item) => ({
      _id: item.item_id,
      name: item.name,
      num: item.quantity,
      price: item.unit_price,
    })),
    package_detail: draft.packages?.map((item) => ({
      weight: item.weight_kg,
      length: item.length_cm,
      width: item.width_cm,
      height: item.height_cm,
      description: item.description,
    })),
  }
}

export function normalizeCity(value: unknown) {
  const item = record(value)
  return MovingCitySchema.parse({
    city_id: item._id,
    name: item.name,
    local_name: stringOrNull(item.name_vi_vn),
    country_id: item.country_id,
    provider_data: redactCredentials(item),
  })
}

export function normalizeService(value: unknown) {
  const item = record(value)
  return MovingServiceOptionSchema.parse({
    service_id: item._id,
    city_id: stringOrNull(item.city_id),
    name: stringOrNull(item.name_vi_vn, item.name),
    description: stringOrNull(item.description_vi_vn, item.description_en_us),
    delivery_type: stringOrNull(item.delivery_type),
    currency: stringOrNull(item.currency),
    cod_limit: numberOrNull(item.cod),
    requests: arrayOfRecords(item.requests).map(redactCredentials),
    provider_data: redactCredentials(item),
  })
}

export function normalizeQuoteOptions(payload: unknown) {
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(record(payload).data) ? record(payload).data as unknown[] : [payload]
  return values.map((value) => {
    const item = record(value)
    const totalPrice = numberOrNull(item.total_price, item.total_fee, item.total_pay)
    if (totalPrice === null) {
      throw new MovingServiceError('PROVIDER_INVALID_RESPONSE', 'AhaMove estimate did not include a total price.')
    }
    return {
      service_id: stringOrNull(item.service_id, item._id) || 'unknown',
      service_name: stringOrNull(item.service_name, item.name_vi_vn, item.name),
      fee: {
        currency: stringOrNull(item.currency) || 'VND',
        distance_km: numberOrNull(item.distance),
        duration_seconds: numberOrNull(item.duration, item.duration_seconds),
        distance_price: numberOrNull(item.distance_price, item.distance_fee),
        stop_point_price: numberOrNull(item.stoppoint_price, item.stop_fee),
        special_request_price: numberOrNull(item.special_request_price, item.request_fee),
        cod_commission_price: numberOrNull(item.cod_commission_price),
        voucher_discount: numberOrNull(item.voucher_discount, item.discount),
        subtotal_price: numberOrNull(item.subtotal_price),
        total_price: totalPrice,
        total_pay: numberOrNull(item.total_pay),
      },
      requests: arrayOfRecords(item.requests).map(redactCredentials),
      provider_data: redactCredentials(item),
    }
  })
}

export function normalizeOrder(
  payload: Record<string, unknown>,
  environment: 'staging' | 'production',
) {
  const timestamps: Record<string, number | null> = {}
  for (const key of ['create_time', 'order_time', 'accept_time', 'board_time', 'pickup_time', 'cancel_time', 'complete_time', 'return_time']) {
    timestamps[key] = numberOrNull(payload[key])
  }
  const totalPrice = numberOrNull(payload.total_price, payload.total_fee, payload.total_pay)
  const fee = totalPrice === null ? null : {
    currency: stringOrNull(payload.currency) || 'VND',
    distance_km: numberOrNull(payload.distance),
    duration_seconds: numberOrNull(payload.duration, payload.duration_seconds),
    distance_price: numberOrNull(payload.distance_price, payload.distance_fee),
    stop_point_price: numberOrNull(payload.stoppoint_price, payload.stop_fee),
    special_request_price: numberOrNull(payload.special_request_price, payload.request_fee),
    cod_commission_price: numberOrNull(payload.cod_commission_price),
    voucher_discount: numberOrNull(payload.voucher_discount, payload.discount),
    subtotal_price: numberOrNull(payload.subtotal_price),
    total_price: totalPrice,
    total_pay: numberOrNull(payload.total_pay),
  }
  return MovingOrderSchema.parse({
    contract_version: '1.0.0',
    provider: 'ahamove',
    environment,
    order_id: payload._id,
    status: stringOrNull(payload.status) || 'UNKNOWN',
    sub_status: stringOrNull(payload.sub_status),
    service_id: stringOrNull(payload.service_id),
    city_id: stringOrNull(payload.city_id),
    distance_km: numberOrNull(payload.distance),
    fee,
    path: arrayOfRecords(payload.path).map(redactCredentials),
    supplier: payload.supplier_id || payload.supplier_name ? {
      id: stringOrNull(payload.supplier_id),
      name: stringOrNull(payload.supplier_name),
    } : null,
    timestamps,
    shared_link: stringOrNull(payload.shared_link),
    provider_data: redactCredentials(payload),
  })
}

export function redactCredentials<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const blocked = new Set(['api_key', 'apikey', 'token', 'refresh_token', 'authorization', 'password', 'secret'])
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (blocked.has(key.toLowerCase())) return [key, '[REDACTED]']
    if (Array.isArray(item)) {
      return [key, item.map((nested) => nested && typeof nested === 'object' ? redactCredentials(nested as Record<string, unknown>) : nested)]
    }
    if (item && typeof item === 'object') return [key, redactCredentials(item as Record<string, unknown>)]
    return [key, item]
  }))
}
