import { isWithinBounds } from '../config/cities'
import type { CityConfig, PoiCollection, PoiFeature, PoiProperties } from '../types'

const API_BASE_URL = (import.meta.env.VITE_PLATFORM_API_URL || 'http://127.0.0.1:4100').replace(
  /\/$/,
  '',
)
const API_PAGE_SIZE = 100
const MAX_API_PAGES = 200

interface PlatformPlace {
  place_id: string
  name: string | null
  category: string
  location: { lng: number; lat: number }
  address: Record<string, unknown>
  phone: string | null
  website: string | null
  verification: { status: string }
  source: { type: string; source_id: string }
  attributes: Record<string, unknown>
}

interface PlaceSearchResponse {
  results: PlatformPlace[]
  next_cursor: string | null
}

const cityCache = new Map<string, PoiCollection>()
let fallbackCache: Promise<PoiCollection> | null = null

export async function loadPois(city: CityConfig, signal?: AbortSignal): Promise<PoiCollection> {
  const cached = cityCache.get(city.id)
  if (cached) return cached

  try {
    const collection = await loadPoisFromApi(city, signal)
    cityCache.set(city.id, collection)
    return collection
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    console.warn('Platform API is unavailable; using the local POI fallback.', error)
    const fallback = await loadFallbackPois()
    const collection: PoiCollection = {
      type: 'FeatureCollection',
      features: fallback.features.filter((feature) =>
        isWithinBounds(feature.geometry.coordinates as [number, number], city),
      ),
    }
    cityCache.set(city.id, collection)
    return collection
  }
}

async function loadPoisFromApi(city: CityConfig, signal?: AbortSignal): Promise<PoiCollection> {
  const [[west, south], [east, north]] = city.bounds
  const features: PoiFeature[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_API_PAGES; page += 1) {
    const response = await fetch(`${API_BASE_URL}/v1/places/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounding_box: { west, south, east, north },
        pagination: { limit: API_PAGE_SIZE, cursor },
      }),
      signal,
    })
    if (!response.ok) throw new Error(`Platform API returned ${response.status}.`)

    const data = (await response.json()) as PlaceSearchResponse
    if (!Array.isArray(data.results)) throw new Error('Platform API returned invalid place data.')
    features.push(...data.results.map(placeToFeature))
    cursor = data.next_cursor
    if (!cursor) return { type: 'FeatureCollection', features }
  }

  throw new Error(`Platform API pagination exceeded ${MAX_API_PAGES} pages.`)
}

async function loadFallbackPois(): Promise<PoiCollection> {
  fallbackCache ||= fetch('/data/accommodations.geojson').then(async (response) => {
    if (!response.ok) throw new Error(`Cannot load local POI fallback (${response.status}).`)
    const data = (await response.json()) as PoiCollection
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('The local POI fallback is not a GeoJSON FeatureCollection.')
    }
    return {
      type: 'FeatureCollection',
      features: data.features.filter(
        (feature) =>
          feature.geometry?.type === 'Point' &&
          feature.geometry.coordinates.length >= 2 &&
          feature.geometry.coordinates.every(Number.isFinite),
      ),
    }
  })
  return fallbackCache
}

function placeToFeature(place: PlatformPlace): PoiFeature {
  const properties: PoiProperties = {
    ...place.attributes,
    ...place.address,
    place_id: place.place_id,
    name: place.name || undefined,
    category: place.category,
    tourism:
      typeof place.attributes.tourism === 'string'
        ? place.attributes.tourism
        : place.category,
    phone: place.phone || undefined,
    website: place.website || undefined,
    verification_status: place.verification.status,
    source_type: place.source.type,
    source_id: place.source.source_id,
  }

  return {
    type: 'Feature',
    id: place.place_id,
    geometry: {
      type: 'Point',
      coordinates: [place.location.lng, place.location.lat],
    },
    properties,
  }
}
