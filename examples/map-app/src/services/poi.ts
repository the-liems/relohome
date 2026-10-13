import { isWithinBounds } from '../config/cities'
import type { CityConfig, PoiCollection, PoiFeature } from '../types'

let poiCache: PoiCollection | null = null

export async function loadPois(): Promise<PoiCollection> {
  if (poiCache) return poiCache

  const response = await fetch('/data/accommodations.geojson')
  if (!response.ok) {
    throw new Error(`Không tải được POI (${response.status}).`)
  }

  const data = (await response.json()) as PoiCollection
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('GeoJSON POI không đúng định dạng FeatureCollection.')
  }

  const validFeatures = data.features.filter(
    (feature) =>
      feature.geometry?.type === 'Point' &&
      feature.geometry.coordinates.length >= 2 &&
      feature.geometry.coordinates.every(Number.isFinite),
  )

  poiCache = { type: 'FeatureCollection', features: validFeatures }
  return poiCache
}

export function searchPois(
  collection: PoiCollection | null,
  city: CityConfig,
  query: string,
  limit = 8,
): PoiFeature[] {
  if (!collection || query.trim().length < 2) return []
  const needle = normalizeText(query)

  return collection.features
    .filter((feature) => isWithinBounds(feature.geometry.coordinates as [number, number], city))
    .filter((feature) => {
      const properties = feature.properties || {}
      const haystack = [
        properties.name,
        properties['name:vi'],
        properties.tourism,
        properties.amenity,
        properties.address,
        properties['addr:street'],
        properties['addr:district'],
      ]
        .filter(Boolean)
        .join(' ')
      return normalizeText(haystack).includes(needle)
    })
    .slice(0, limit)
}

export function getPoiAddress(properties: Record<string, unknown>) {
  if (typeof properties.address === 'string' && properties.address.trim()) {
    return properties.address
  }

  const parts = [
    properties['addr:housenumber'],
    properties['addr:street'],
    properties['addr:ward'],
    properties['addr:district'],
    properties['addr:city'],
  ].filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))

  return parts.join(', ')
}

export function getProperty(
  properties: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}
