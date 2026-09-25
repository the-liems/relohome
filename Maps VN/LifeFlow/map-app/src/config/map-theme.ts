import type { PoiGroup } from './poi-groups'

export const MAP_THEME = {
  primary: '#128c7e',
  primaryDark: '#0b675e',
  primarySoft: '#dff3ef',
  route: '#087f73',
  routeCasing: 'rgba(255, 255, 255, 0.94)',
  selected: '#075e54',
  cluster: {
    low: '#4b9f93',
    medium: '#218579',
    high: '#0d655d',
    text: '#ffffff',
  },
  categories: {
    accommodation: '#178f83',
    healthcare: '#d85b67',
    shopping: '#e28a2f',
    education: '#397fc5',
    food: '#d97832',
    transport: '#6674aa',
    utility: '#697b85',
    lifestyle: '#4d9a65',
    housing: '#075e54',
  },
} as const

export const POI_ICON_NAME: Record<PoiGroup, string> = {
  accommodation: 'poi-accommodation',
  healthcare: 'poi-healthcare',
  shopping: 'poi-shopping',
  education: 'poi-education',
  food: 'poi-food',
  transport: 'poi-transport',
  utility: 'poi-utility',
  lifestyle: 'poi-lifestyle',
}

export const MAP_LAYER_IDS = {
  poiSource: 'lifeflow-pois',
  cluster: 'poi-clusters',
  clusterCount: 'poi-cluster-count',
  poiHover: 'poi-hover-halo',
  poi: 'poi-points',
  housingSource: 'lifeflow-housing',
  housing: 'housing-price-markers',
  routeSource: 'lifeflow-route',
  routeCasing: 'route-casing',
  route: 'route-line',
  selectedSource: 'lifeflow-selected-poi',
  selectedHalo: 'selected-poi-halo',
  selected: 'selected-poi',
} as const

export const MAP_ZOOM_RULES = {
  clusterMaxZoom: 13,
  individualPoiMinZoom: 12,
  selectedZoom: 15,
} as const
