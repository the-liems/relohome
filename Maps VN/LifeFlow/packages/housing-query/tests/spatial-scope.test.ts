import { expect, it } from 'vitest'
import { definitelyDisjointScope } from '../src/spatial-scope.js'

it('only rejects a provably disjoint radius and viewport, including an empty radius map pan', () => {
  const center = { lng: 0, lat: 0 }, radius_m = 1000
  expect(definitelyDisjointScope({ center, radius_m, bounding_box: { west: 1, east: 2, south: -1, north: 1 } })).toBe(true)
  expect(definitelyDisjointScope({ center, radius_m, bounding_box: { west: -1, east: 1, south: 1, north: 2 } })).toBe(true)
  expect(definitelyDisjointScope({ center, radius_m, bounding_box: { west: -1, east: 1, south: -1, north: 1 } })).toBe(false)
  expect(definitelyDisjointScope({ center, radius_m, bounding_box: { west: 0.0089, east: 0.01, south: -0.001, north: 0.001 } })).toBe(false)
})

it('does not invent an empty intersection at a pole or longitude wrap', () => {
  expect(definitelyDisjointScope({ center: { lat: 89.99, lng: 0 }, radius_m: 2000,
    bounding_box: { west: 179, east: 180, south: 89.98, north: 89.999 } })).toBe(false)
  expect(definitelyDisjointScope({ center: { lat: 0, lng: 179.999 }, radius_m: 2000,
    bounding_box: { west: -180, east: -179.99, south: -0.01, north: 0.01 } })).toBe(false)
  expect(definitelyDisjointScope({ center: { lat: 0, lng: 0 }, radius_m: 2000 })).toBe(false)
})
