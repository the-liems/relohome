import type { CityConfig, CityId, Coordinates } from '../types'

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export const CITY_CONFIG: Record<CityId, CityConfig> = {
  hcm: {
    id: 'hcm', label: 'TP.HCM', shortLabel: 'HCM', center: [106.7009, 10.7769], zoom: 13.15,
    bounds: [[106.34, 10.34], [107.05, 11.2]],
    osrmBaseUrls: { driving: 'http://127.0.0.1:5000', walking: 'http://127.0.0.1:5010', motorcycle: 'http://127.0.0.1:5020' },
  },
  hanoi: {
    id: 'hanoi', label: 'Hà Nội', shortLabel: 'Hà Nội', center: [105.8432, 21.0278], zoom: 13.15,
    bounds: [[105.28, 20.55], [106.04, 21.4]],
    osrmBaseUrls: { driving: 'http://127.0.0.1:5001', walking: 'http://127.0.0.1:5011', motorcycle: 'http://127.0.0.1:5021' },
  },
  danang: {
    id: 'danang', label: 'Đà Nẵng', shortLabel: 'Đà Nẵng', center: [108.2208, 16.0678], zoom: 13.15,
    bounds: [[107.78, 15.88], [108.42, 16.3]],
    osrmBaseUrls: { driving: 'http://127.0.0.1:5002', walking: 'http://127.0.0.1:5012', motorcycle: 'http://127.0.0.1:5022' },
  },
}

export const CITY_ORDER: CityId[] = ['hcm', 'hanoi', 'danang']

export function isWithinBounds(coordinate: Coordinates, city: CityConfig) {
  const [[minLng, minLat], [maxLng, maxLat]] = city.bounds
  return coordinate[0] >= minLng && coordinate[0] <= maxLng && coordinate[1] >= minLat && coordinate[1] <= maxLat
}
