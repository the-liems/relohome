import { expect, it } from 'vitest'
import { AreaGeometrySchema, SearchAreasRequestSchema } from '../src/location.js'
import { HousingMapRequestSchema, HousingSearchRequestSchema } from '../src/housing.js'

it('accepts an optional administrative parent ID without changing older area requests', () => {
  expect(SearchAreasRequestSchema.parse({ text: 'Bình Thạnh', within_area_id: ' hcm ' }).within_area_id).toBe('hcm')
  expect(SearchAreasRequestSchema.parse({ text: 'Bình Thạnh' }).within_area_id).toBeUndefined()
  expect(SearchAreasRequestSchema.safeParse({ text: 'Bình Thạnh', within_area_id: '' }).success).toBe(false)
})

it('keeps a viewport AND radius; both are applied by the query service', () => {
  const input = { center: { lat: 21, lng: 105.8 }, radius_m: 2000,
    bounding_box: { west: 105.7, south: 20.9, east: 105.9, north: 21.1 } }
  expect(HousingSearchRequestSchema.parse(input)).toMatchObject(input)
  expect(HousingMapRequestSchema.parse({ ...input, zoom: 16 })).toMatchObject(input)
  expect(HousingMapRequestSchema.safeParse({ center: input.center, bounding_box: input.bounding_box, zoom: 16 }).success).toBe(false)
})

it('geometry is opt-in and preserves polygon holes and multipolygons', () => {
  expect(SearchAreasRequestSchema.parse({ text: 'test' }).include_geometry).toBe(false)
  expect(SearchAreasRequestSchema.parse({ text: 'test', include_geometry: true }).include_geometry).toBe(true)
  const rings = [[[0, 0], [2, 0], [2, 2], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]]
  expect(AreaGeometrySchema.parse({ type: 'MultiPolygon', coordinates: [rings, [rings[0]]] }).coordinates).toEqual([rings, [rings[0]]])
  expect(AreaGeometrySchema.safeParse({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 1]]] }).success).toBe(false)
  expect(AreaGeometrySchema.safeParse({ type: 'Polygon', coordinates: [[[181, 0], [2, 0], [2, 2], [181, 0]]] }).success).toBe(false)
})
