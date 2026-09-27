import type { PoiGroup } from './poi-groups'

export const MAP_THEME = {
  primary: '#f97316',
  primaryDark: '#c2410c',
  primarySoft: '#fff1e8',
  route: '#347fd6',
  routeCasing: 'rgba(255, 255, 255, 0.96)',
  selected: '#347fd6',
  poiBorder: '#365364',
  housingMarker: {
    fill: '#d6efe9',
    border: '#176e69',
    text: '#0b675e',
    hoverFill: '#f0fcf9',
  },
  basemap: {
    land: '#ebf0f0',
    residential: '#f6f5f5',
    water: '#75c2ef',
    waterway: '#62bbea',
    park: '#d2f8e2',
    wood: '#c8f0d8',
    building: '#e5eaf0',
    buildingOutline: '#d2dae3',
    minorRoad: '#c2cdd8',
    majorRoad: '#a5b6c8',
    motorway: '#7f9bb8',
    roadInner: '#f6f5f5',
  },
  cluster: {
    low: '#788f9b',
    medium: '#5f7e91',
    high: '#405e70',
    text: '#ffffff',
  },
  categories: {
    accommodation: '#788f9b',
    healthcare: '#e47bb6',
    shopping: '#63a6e9',
    education: '#63a6e9',
    food: '#ff9933',
    transport: '#63a6e9',
    utility: '#788f9b',
    lifestyle: '#36b95c',
    housing: '#f97316',
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
  housingCluster: 'housing-clusters',
  housingClusterCount: 'housing-cluster-count',
  housing: 'housing-price-markers',
  housingInteractionSource: 'lifeflow-housing-interaction',
  housingHover: 'housing-hover-marker',
  housingSelected: 'housing-selected-marker',
  routeSource: 'lifeflow-route',
  routeCasing: 'route-casing',
  route: 'route-line',
  selectedSource: 'lifeflow-selected-poi',
  selectedHalo: 'selected-poi-halo',
  selected: 'selected-poi',
} as const

export const MAP_ZOOM_RULES = {
  clusterMaxZoom: 13,
  individualPoiMinZoom: 13,
  selectedZoom: 15,
} as const
