import { describe, expect, it } from 'vitest'
import {
  normalizePoiCategory,
  normalizedAddress,
  parseOsmIdentity,
} from '../src/poi-normalization.js'

describe('POI normalization', () => {
  it.each([
    [{ amenity: 'hospital' }, 'hospital'],
    [{ shop: 'supermarket' }, 'supermarket'],
    [{ leisure: 'fitness_centre' }, 'gym'],
    [{ amenity: 'restaurant' }, 'restaurant'],
    [{ healthcare: 'physiotherapist' }, 'other_healthcare'],
    [{ shop: 'bakery' }, 'shop_other'],
    [{ tourism: 'hotel', amenity: 'cafe' }, 'hotel'],
  ])('normalizes %j to %s', (tags, expected) => {
    expect(normalizePoiCategory(tags)).toBe(expected)
  })

  it('does not invent a category or name for unrelated tags', () => {
    expect(normalizePoiCategory({ building: 'yes' })).toBeNull()
  })

  it('preserves address tags without changing coordinate semantics', () => {
    expect(normalizedAddress({ 'addr:housenumber': '12', 'addr:street': 'Lê Lợi', name: 'A' }))
      .toEqual({ 'addr:housenumber': '12', 'addr:street': 'Lê Lợi' })
  })

  it('parses stable Osmium type IDs', () => {
    expect(parseOsmIdentity('n481837735')).toEqual({
      sourceId: 'node/481837735',
      osmType: 'node',
      osmId: 481837735,
    })
    expect(parseOsmIdentity('way/123')).toMatchObject({ sourceId: 'way/123', osmType: 'way' })
    expect(parseOsmIdentity('a57694072')).toEqual({
      sourceId: 'area/57694072', osmType: 'way', osmId: 28847036,
    })
    expect(parseOsmIdentity('a57694073')).toEqual({
      sourceId: 'area/57694073', osmType: 'relation', osmId: 28847036,
    })
  })
})
