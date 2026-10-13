import type {
  HousingCollection,
  HousingMapProperties,
  HousingViewport,
} from '../types'

const API_BASE_URL = (import.meta.env.VITE_PLATFORM_API_URL || 'http://127.0.0.1:4100').replace(/\/$/, '')

interface HousingMapListing {
  kind: 'listing'
  listing_id: string
  title: string
  property_type: string
  listing_type: string
  location: { lng: number; lat: number }
  address: Record<string, unknown>
  price: {
    amount: number
    currency: 'VND' | 'USD'
    period: 'night' | 'day' | 'week' | 'month' | 'year' | 'total'
  }
  bedrooms: number | null
  bathrooms: number | null
  area_m2: number | null
  amenities: string[]
  source_url: string | null
  thumbnail_url: string | null
  location_accuracy: 'rooftop' | 'approximate' | 'unknown'
}

interface HousingMapCluster {
  kind: 'cluster'
  cluster_id: string
  location: { lng: number; lat: number }
  count: number
  min_price_amount: number
  currency: 'VND' | 'USD'
}

interface HousingMapResponse {
  features: Array<HousingMapListing | HousingMapCluster>
  meta: { mode: 'clusters' | 'listings'; returned_count: number; truncated: boolean }
}

export async function loadHousing(
  viewport: HousingViewport,
  signal?: AbortSignal,
): Promise<HousingCollection> {
  const response = await fetch(`${API_BASE_URL}/v1/housing/map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bounding_box: viewport.boundingBox,
      zoom: viewport.zoom,
      property_type: ['apartment', 'house', 'room', 'studio', 'serviced_apartment', 'homestay'],
      listing_type: ['rent', 'short_stay'],
      limit: 1_000,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Không tải được dữ liệu nhà ở (Platform API ${response.status}).`)

  const payload = await response.json() as HousingMapResponse
  if (!Array.isArray(payload.features)) throw new Error('Platform API trả về dữ liệu nhà ở không hợp lệ.')

  return {
    type: 'FeatureCollection',
    features: payload.features.map((feature) => feature.kind === 'listing'
      ? {
          type: 'Feature' as const,
          id: feature.listing_id,
          geometry: { type: 'Point' as const, coordinates: [feature.location.lng, feature.location.lat] },
          properties: toMapProperties(feature),
        }
      : {
          type: 'Feature' as const,
          id: `cluster:${feature.cluster_id}`,
          geometry: { type: 'Point' as const, coordinates: [feature.location.lng, feature.location.lat] },
          properties: {
            entity_kind: 'housing_cluster' as const,
            cluster_id: feature.cluster_id,
            cluster_count: feature.count,
            price_amount: feature.min_price_amount,
            price_currency: feature.currency,
            price_label: `từ ${formatPrice(feature.min_price_amount, feature.currency, 'total')}`,
          },
        }),
  }
}

function toMapProperties(listing: HousingMapListing): HousingMapProperties {
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
    area_m2: listing.area_m2,
    amenities: listing.amenities,
    source_url: listing.source_url,
    thumbnail_url: listing.thumbnail_url,
    location_accuracy: listing.location_accuracy,
  }
}

function formatAddress(address: Record<string, unknown>) {
  return Object.entries(address)
    .filter(([key, value]) => key !== 'raw' && typeof value === 'string' && Boolean(value.trim()))
    .map(([, value]) => value)
    .join(', ')
}

function formatPrice(
  amount: number,
  currency: 'VND' | 'USD',
  period: HousingMapProperties['price_period'],
) {
  const suffix = {
    night: '/đêm',
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
