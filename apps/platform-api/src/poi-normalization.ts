export type OsmTags = Record<string, unknown>

const amenityCategories: Record<string, string> = {
  hospital: 'hospital',
  clinic: 'clinic',
  pharmacy: 'pharmacy',
  doctors: 'doctor',
  dentist: 'dentist',
  marketplace: 'marketplace',
  school: 'school',
  kindergarten: 'kindergarten',
  college: 'college',
  university: 'university',
  restaurant: 'restaurant',
  cafe: 'cafe',
  fast_food: 'fast_food',
  food_court: 'food_court',
  bus_station: 'bus_station',
  bank: 'bank',
  atm: 'atm',
  fuel: 'fuel',
  parking: 'parking',
  charging_station: 'ev_charging',
}

const healthcareCategories: Record<string, string> = {
  hospital: 'hospital',
  clinic: 'clinic',
  pharmacy: 'pharmacy',
  doctor: 'doctor',
  doctors: 'doctor',
  dentist: 'dentist',
}

const shopCategories: Record<string, string> = {
  supermarket: 'supermarket',
  convenience: 'convenience_store',
  mall: 'shopping_mall',
}

const leisureCategories: Record<string, string> = {
  fitness_centre: 'gym',
  sports_centre: 'sports_centre',
  park: 'park',
  swimming_pool: 'swimming_pool',
}

const accommodationCategories: Record<string, string> = {
  hotel: 'hotel',
  guest_house: 'guest_house',
  hostel: 'hostel',
  motel: 'motel',
  apartment: 'apartment',
  camp_site: 'camp_site',
  chalet: 'chalet',
  resort: 'resort',
  homestay: 'homestay',
}

function tag(tags: OsmTags, key: string) {
  const value = tags[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

export function normalizePoiCategory(tags: OsmTags): string | null {
  const tourism = tag(tags, 'tourism')
  if (tourism && accommodationCategories[tourism]) return accommodationCategories[tourism]

  const amenity = tag(tags, 'amenity')
  if (amenity && amenityCategories[amenity]) return amenityCategories[amenity]

  const healthcare = tag(tags, 'healthcare')
  if (healthcare) return healthcareCategories[healthcare] || 'other_healthcare'

  const shop = tag(tags, 'shop')
  if (shop) return shopCategories[shop] || 'shop_other'

  const railway = tag(tags, 'railway')
  if (railway === 'station' || railway === 'halt') return 'rail_station'
  if (tag(tags, 'highway') === 'bus_stop') return 'bus_stop'

  const aeroway = tag(tags, 'aeroway')
  if (aeroway === 'aerodrome') return 'airport'
  if (aeroway === 'terminal') return 'airport_terminal'
  if (tag(tags, 'public_transport')) return 'public_transport_other'

  const leisure = tag(tags, 'leisure')
  if (leisure && leisureCategories[leisure]) return leisureCategories[leisure]

  return null
}

export function normalizedAddress(tags: OsmTags) {
  return Object.fromEntries(
    Object.entries(tags).filter(([key, value]) => key.startsWith('addr:') && value !== null),
  )
}

export function optionalTag(tags: OsmTags, ...keys: string[]) {
  for (const key of keys) {
    const value = tags[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function parseOsmIdentity(id: unknown) {
  if (typeof id !== 'string') return null
  const area = /^a(\d+)$/.exec(id)
  if (area) {
    const areaId = Number(area[1])
    if (!Number.isSafeInteger(areaId) || areaId < 1) return null
    const osmType = areaId % 2 === 0 ? 'way' : 'relation'
    return { sourceId: `area/${areaId}`, osmType, osmId: Math.floor(areaId / 2) }
  }
  const short = /^([nwr])(\d+)$/.exec(id)
  if (short) {
    const osmType = { n: 'node', w: 'way', r: 'relation' }[short[1]!]!
    return { sourceId: `${osmType}/${short[2]}`, osmType, osmId: Number(short[2]) }
  }
  const long = /^(node|way|relation)\/(\d+)$/.exec(id)
  if (!long) return null
  return { sourceId: id, osmType: long[1]!, osmId: Number(long[2]) }
}
