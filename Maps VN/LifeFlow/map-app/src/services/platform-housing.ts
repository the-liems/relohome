import type {
  CityConfig,
  HousingCollection,
  HousingMapProperties,
} from '../types'

const API_BASE_URL = (import.meta.env.VITE_PLATFORM_API_URL || 'http://127.0.0.1:4100').replace(/\/$/, '')
const cityCache = new Map<string, { collection: HousingCollection; loadedAt: number }>()
const CACHE_TTL_MS = 5 * 60_000

interface HousingSearchResult {
  listing_id: string
  title: string
  property_type: string
  listing_type: string
  location: { lng: number; lat: number }
  address: Record<string, unknown>
  price: {
    amount: number
    currency: 'VND' | 'USD'
    period: 'day' | 'week' | 'month' | 'year' | 'total'
  }
  bedrooms: number | null
  bathrooms: number | null
  area: { value: number; unit: 'm2' } | null
  amenities: string[]
  source: { source_url?: string | null }
}

interface HousingSearchResponse {
  results: HousingSearchResult[]
}

export async function loadHousing(
  city: CityConfig,
  signal?: AbortSignal,
): Promise<HousingCollection> {
  const cached = cityCache.get(city.id)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.collection

  const [[west, south], [east, north]] = city.bounds
  const response = await fetch(`${API_BASE_URL}/v1/housing/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bounding_box: { west, south, east, north },
      property_type: [
        'apartment',
        'house',
        'room',
        'studio',
        'serviced_apartment',
        'homestay',
      ],
      listing_type: ['rent', 'short_stay'],
      pagination: { limit: 100, cursor: null },
      sort: [{ field: 'created_at', direction: 'desc' }],
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Không tải được dữ liệu nhà ở (Platform API ${response.status}).`)

  const payload = await response.json() as HousingSearchResponse
  if (!Array.isArray(payload.results)) {
    throw new Error('Platform API trả về dữ liệu nhà ở không hợp lệ.')
  }

  const collection: HousingCollection = {
    type: 'FeatureCollection',
    features: payload.results.map((listing) => ({
      type: 'Feature',
      id: listing.listing_id,
      geometry: {
        type: 'Point',
        coordinates: [listing.location.lng, listing.location.lat],
      },
      properties: toMapProperties(listing),
    })),
  }

  signal?.throwIfAborted()
  cityCache.set(city.id, { collection, loadedAt: Date.now() })
  return collection
}

function toMapProperties(listing: HousingSearchResult): HousingMapProperties {
  return {
    entity_kind: 'housing',
    listing_id: listing.listing_id,
    name: listing.title,
    title: listing.title,
    property_type: listing.property_type,
    listing_type: listing.listing_type,
    category: listing.property_type,
    group: 'accommodation',
    address: formatAddress(listing.address),
    price_amount: listing.price.amount,
    price_currency: listing.price.currency,
    price_period: listing.price.period,
    price_label: formatPrice(listing.price.amount, listing.price.currency, listing.price.period),
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    area_m2: listing.area?.value ?? null,
    amenities: listing.amenities,
    source_url: listing.source.source_url ?? null,
  }
}

function formatAddress(address: Record<string, unknown>) {
  return Object.values(address)
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(', ')
}

function formatPrice(
  amount: number,
  currency: 'VND' | 'USD',
  period: HousingMapProperties['price_period'],
) {
  const suffix = {
    day: '/ngày',
    week: '/tuần',
    month: '/tháng',
    year: '/năm',
    total: '',
  }[period]
  if (currency === 'VND' && amount >= 1_000_000) {
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(amount / 1_000_000)} tr${suffix}`
  }
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ${currency}${suffix}`
}
