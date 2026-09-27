import type { Feature, FeatureCollection, LineString, Point } from 'geojson'

export type CityId = 'hcm' | 'hanoi' | 'danang'
export type RouteProfile = 'driving' | 'motorcycle' | 'walking'
export type Coordinates = [number, number]
export type Bounds = [Coordinates, Coordinates]

export interface CityConfig {
  id: CityId
  label: string
  shortLabel: string
  center: Coordinates
  zoom: number
  bounds: Bounds
  osrmBaseUrls: Record<RouteProfile, string>
}

export interface PoiProperties {
  [key: string]: unknown
  name?: string
  tourism?: string
  amenity?: string
  address?: string
  phone?: string
  website?: string
  opening_hours?: string
  category?: string
  group?: string
}

export type PoiFeature = Feature<Point, PoiProperties>
export type PoiCollection = FeatureCollection<Point, PoiProperties>

export interface HousingMapProperties extends PoiProperties {
  entity_kind: 'housing'
  listing_id: string
  name: string
  title: string
  property_type: string
  listing_type: string
  address: string
  price_amount: number
  price_currency: 'VND' | 'USD'
  price_period: 'night' | 'day' | 'week' | 'month' | 'year' | 'total'
  price_label: string
  bedrooms: number | null
  bathrooms: number | null
  area_m2: number | null
  amenities: string[]
  source_url: string | null
  thumbnail_url: string | null
  location_accuracy: 'rooftop' | 'approximate' | 'unknown'
}

export interface HousingClusterProperties extends PoiProperties {
  entity_kind: 'housing_cluster'
  cluster_id: string
  cluster_count: number
  price_amount: number
  price_currency: 'VND' | 'USD'
  price_label: string
}

export type HousingFeature = Feature<Point, HousingMapProperties | HousingClusterProperties>
export type HousingCollection = FeatureCollection<Point, HousingMapProperties | HousingClusterProperties>

export interface HousingViewport {
  boundingBox: { west: number; south: number; east: number; north: number }
  zoom: number
}

export interface RouteResult {
  distanceMeters: number
  durationSeconds: number
  geometry: Feature<LineString>
}

export interface RoutePoint {
  coordinate: Coordinates
  label: 'A' | 'B'
}

export type RouteStatus = 'idle' | 'selecting-end' | 'loading' | 'ready' | 'error'
