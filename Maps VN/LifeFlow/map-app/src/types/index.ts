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
