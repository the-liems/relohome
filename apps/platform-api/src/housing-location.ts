import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { ManagementError } from './housing-management.js'

const Point = z.object({
  lat: z.number().finite().min(8).max(24),
  lng: z.number().finite().min(102).max(110),
})
export const LocationTokenInput = z.object({
  location_token: z.string().max(8000).optional(),
})
const Claim = z.object({
  user: z.string(),
  ref_id: z.string(),
  address: z.string().trim().min(1),
  location: Point,
  expires: z.number(),
  source: z.literal('vietmap'),
  components: z.record(z.string(), z.string()).default({}),
  precision: z.enum(['provider', 'host_pin']).default('provider'),
})
type LocationClaim = z.infer<typeof Claim>
const cache = new Map<string, { expires: number; results: unknown[] }>()
const requests = new Map<string, { window: number; count: number }>()

function secret() {
  const key = process.env.AGENT_API_TOKEN
  if (!key) throw new ManagementError(503, 'Dịch vụ vị trí chưa được cấu hình.', 'location_unavailable')
  return key
}
function signature(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}
export function signLocation(
  user: string,
  result: {
    ref_id: string
    address: string
    location: { lat: number; lng: number }
    components?: Record<string, string>
    precision?: 'provider' | 'host_pin'
  },
) {
  const claim = Claim.parse({
    ...result,
    user,
    expires: Date.now() + 30 * 60_000,
    source: 'vietmap',
  })
  const body = Buffer.from(JSON.stringify(claim)).toString('base64url')
  return body + '.' + signature(body)
}
export function verifyLocation(
  token: string,
  user: string,
  address: string,
  location: { lat: number; lng: number },
): LocationClaim {
  try {
    const [body, signed, extra] = token.split('.')
    const expected = Buffer.from(signature(body || ''))
    const supplied = Buffer.from(signed || '')
    if (extra || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new Error('signature')
    const claim = Claim.parse(JSON.parse(Buffer.from(body || '', 'base64url').toString()))
    if (
      claim.user !== user ||
      claim.expires < Date.now() ||
      claim.address.trim() !== address.trim() ||
      Math.abs(claim.location.lat - location.lat) > 1e-8 ||
      Math.abs(claim.location.lng - location.lng) > 1e-8
    )
      throw new Error('claim')
    return claim
  } catch {
    throw new ManagementError(
      409,
      'Địa chỉ hoặc vị trí đã thay đổi. Hãy chọn và xác nhận lại vị trí.',
      'location_confirmation_required',
    )
  }
}

function limit(user: string) {
  const now = Date.now(),
    row = requests.get(user)
  if (!row || row.window < now - 60_000) requests.set(user, { window: now, count: 1 })
  else if (++row.count > 30)
    throw new ManagementError(429, 'Bạn đang tìm vị trí quá nhanh. Hãy thử lại sau.', 'location_rate_limited')
  if (requests.size > 1000)
    for (const [key, value] of requests) if (value.window < now - 60_000) requests.delete(key)
}
async function provider(endpoint: 'autocomplete/v4' | 'place/v4', parameters: Record<string, string>) {
  const key = process.env.VIETMAP_API_KEY?.trim()
  if (!key)
    throw new ManagementError(
      503,
      'Chưa cấu hình Vietmap. Bạn có thể lưu nháp và xác nhận vị trí sau.',
      'location_unavailable',
    )
  const url = new URL('https://maps.vietmap.vn/api/' + endpoint)
  url.search = new URLSearchParams({ apikey: key, ...parameters }).toString()
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  } catch {
    throw new ManagementError(502, 'Chưa nhận được vị trí từ Vietmap. Hãy thử lại.', 'location_unavailable')
  }
  if ([402, 429].includes(response.status))
    throw new ManagementError(
      503,
      'Dịch vụ vị trí đang bận hoặc hết hạn mức. Hãy thử lại sau.',
      'location_unavailable',
    )
  if (!response.ok)
    throw new ManagementError(502, 'Không tìm được vị trí từ dịch vụ bản đồ.', 'location_unavailable')
  try {
    return (await response.json()) as unknown
  } catch {
    throw new ManagementError(502, 'Dịch vụ bản đồ trả dữ liệu không hợp lệ.', 'location_unavailable')
  }
}
export async function searchHousingAddress(user: string, text: string) {
  limit(user)
  const query = z.string().trim().min(3).max(220).parse(text)
  const found = cache.get(query)
  if (found && found.expires > Date.now()) return { results: found.results }
  const raw = await provider('autocomplete/v4', {
    text: query,
    layers: 'ADDRESS,STREET,POI',
    display_type: '5',
  })
  if (!Array.isArray(raw))
    throw new ManagementError(502, 'Dịch vụ bản đồ trả dữ liệu không hợp lệ.', 'location_unavailable')
  const results = raw.slice(0, 10).flatMap((value) => {
    const parsed = z
      .object({
        ref_id: z.string().min(1).max(2048),
        display: z.string().min(1),
        name: z.string().optional(),
      })
      .safeParse(value)
    return parsed.success
      ? [
          {
            ref_id: parsed.data.ref_id,
            display: parsed.data.display,
            name: parsed.data.name || parsed.data.display,
          },
        ]
      : []
  })
  if (cache.size > 300) cache.clear()
  cache.set(query, { expires: Date.now() + 5 * 60_000, results })
  return { results }
}
export async function resolveHousingAddress(user: string, ref: string) {
  limit(user)
  const ref_id = z.string().trim().min(1).max(2048).parse(ref)
  const raw = await provider('place/v4', { refid: ref_id })
  const parsed = z
    .object({
      display: z.string().trim().min(1),
      lat: Point.shape.lat,
      lng: Point.shape.lng,
      hs_num: z.string().optional(),
      street: z.string().optional(),
      ward: z.string().optional(),
      district: z.string().optional(),
      city: z.string().optional(),
    })
    .safeParse(raw)
  if (!parsed.success)
    throw new ManagementError(
      422,
      'Kết quả chưa có địa chỉ và tọa độ hợp lệ trong vùng hỗ trợ.',
      'location_unavailable',
    )
  const data = parsed.data,
    result = {
      ref_id,
      address: data.display,
      location: { lat: data.lat, lng: data.lng },
    }
  return {
    ...result,
    components: {
      housenumber: data.hs_num,
      street: data.street,
      ward: data.ward,
      district: data.district,
      city: data.city,
    },
    accuracy: 'approximate',
    location_token: signLocation(user, {
      ...result,
      components: Object.fromEntries(
        Object.entries({ ward: data.ward, district: data.district, city: data.city }).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    }),
  }
}

export function confirmHousingLocation(user: string, input: unknown) {
  const request = z
    .object({
      location_token: z.string().max(8000),
      location: Point,
      private_detail: z.string().trim().max(300).default(''),
    })
    .parse(input)
  const [body] = request.location_token.split('.')
  let original: LocationClaim
  try {
    original = Claim.parse(JSON.parse(Buffer.from(body || '', 'base64url').toString()))
  } catch {
    throw new ManagementError(409, 'Hãy chọn lại địa chỉ từ gợi ý.', 'location_confirmation_required')
  }
  // Decoding alone never authorizes anything; verify the original signed lookup first.
  verifyLocation(request.location_token, user, original.address, original.location)
  const radians = Math.PI / 180
  const dLat = (request.location.lat - original.location.lat) * radians,
    dLng = (request.location.lng - original.location.lng) * radians
  const distance =
    2 *
    6371000 *
    Math.asin(
      Math.sqrt(
        Math.sin(dLat / 2) ** 2 +
          Math.cos(original.location.lat * radians) *
            Math.cos(request.location.lat * radians) *
            Math.sin(dLng / 2) ** 2,
      ),
    )
  if (distance > 2000)
    throw new ManagementError(
      422,
      'Ghim quá xa địa chỉ đã chọn. Hãy tìm lại địa chỉ phù hợp.',
      'location_confirmation_required',
    )
  const address = [request.private_detail, original.address].filter(Boolean).join(', ')
  const final = {
    ref_id: original.ref_id,
    address,
    location: request.location,
    components: original.components,
    precision: 'host_pin' as const,
  }
  return { ...final, location_token: signLocation(user, final) }
}
