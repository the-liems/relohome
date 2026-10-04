import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl'
import { BASEMAP_STYLE_URL } from '../config/cities'
import { MAP_LAYER_IDS, MAP_THEME, MAP_ZOOM_RULES, POI_ICON_NAME } from '../config/map-theme'
import type { PoiGroup } from '../config/poi-groups'
import type {
  CityConfig,
  Coordinates,
  HousingCollection,
  HousingFeature,
  HousingMapProperties,
  HousingViewport,
  PoiCollection,
  PoiFeature,
  PoiProperties,
  RoutePoint,
  RouteResult,
} from '../types'
import { PoiPopup } from './PoiPopup'

const EMPTY_COLLECTION: PoiCollection = { type: 'FeatureCollection', features: [] }
const EMPTY_HOUSING: HousingCollection = { type: 'FeatureCollection', features: [] }
const EMPTY_HOUSING_INTERACTION: HousingCollection = { type: 'FeatureCollection', features: [] }
const EMPTY_SELECTED: GeoJSON.FeatureCollection<GeoJSON.Point, PoiProperties> = {
  type: 'FeatureCollection',
  features: [],
}
const POI_ICON_EXPRESSION: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'group'],
  'accommodation', POI_ICON_NAME.accommodation,
  'healthcare', POI_ICON_NAME.healthcare,
  'shopping', POI_ICON_NAME.shopping,
  'education', POI_ICON_NAME.education,
  'food', POI_ICON_NAME.food,
  'transport', POI_ICON_NAME.transport,
  'utility', POI_ICON_NAME.utility,
  'lifestyle', POI_ICON_NAME.lifestyle,
  POI_ICON_NAME.accommodation,
]
const HOUSING_PRICE_EXPRESSION: maplibregl.ExpressionSpecification = [
  'case',
  ['==', ['get', 'price_currency'], 'USD'],
  ['concat', '$', ['to-string', ['round', ['get', 'price_amount']]]],
  ['concat', ['to-string', ['/', ['round', ['/', ['get', 'price_amount'], 100000]], 10]], ' tr'],
]
const HOUSING_PILL_IMAGE = 'housing-price-pill'
const HOUSING_PILL_HOVER_IMAGE = 'housing-price-pill-hover'
const HOUSING_PILL_SELECTED_IMAGE = 'housing-price-pill-selected'

interface FocusRequest {
  poi: PoiFeature
  token: number
}

interface MapViewProps {
  city: CityConfig
  pois: PoiCollection | null
  housing: HousingCollection | null
  points: RoutePoint[]
  route: RouteResult | null
  focusRequest: FocusRequest | null
  selectedHousing: HousingFeature | null
  hoveredHousing: HousingFeature | null
  showPois: boolean
  routePickingEnabled: boolean
  onHousingSelect: (feature: HousingFeature & { properties: HousingMapProperties }) => void
  onHousingHover: (feature: (HousingFeature & { properties: HousingMapProperties }) | null) => void
  onMapBackground: () => void
  onMapPoint: (coordinate: Coordinates) => void
  onViewportChange: (viewport: HousingViewport) => void
  onMapError: (message: string) => void
}

interface ActivePopup {
  popup: maplibregl.Popup
  root: Root
}

export function MapView({
  city,
  pois,
  housing,
  points,
  route,
  focusRequest,
  selectedHousing,
  hoveredHousing,
  showPois,
  routePickingEnabled,
  onHousingSelect,
  onHousingHover,
  onMapBackground,
  onMapPoint,
  onViewportChange,
  onMapError,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRefs = useRef<maplibregl.Marker[]>([])
  const activePopupRef = useRef<ActivePopup | null>(null)
  const hoveredPoiRef = useRef<string | number | null>(null)
  const hoveredHousingIdRef = useRef<string | null>(null)
  const initialCityRef = useRef(city)
  const pointHandlerRef = useRef(onMapPoint)
  const housingSelectHandlerRef = useRef(onHousingSelect)
  const housingHoverHandlerRef = useRef(onHousingHover)
  const mapBackgroundHandlerRef = useRef(onMapBackground)
  const routePickingRef = useRef(routePickingEnabled)
  const viewportHandlerRef = useRef(onViewportChange)
  const errorHandlerRef = useRef(onMapError)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    pointHandlerRef.current = onMapPoint
  }, [onMapPoint])

  useEffect(() => {
    housingSelectHandlerRef.current = onHousingSelect
  }, [onHousingSelect])

  useEffect(() => {
    housingHoverHandlerRef.current = onHousingHover
  }, [onHousingHover])

  useEffect(() => {
    mapBackgroundHandlerRef.current = onMapBackground
  }, [onMapBackground])

  useEffect(() => {
    routePickingRef.current = routePickingEnabled
  }, [routePickingEnabled])

  useEffect(() => {
    viewportHandlerRef.current = onViewportChange
  }, [onViewportChange])

  useEffect(() => {
    errorHandlerRef.current = onMapError
  }, [onMapError])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let reportedStyleError = false
    const initialCity = initialCityRef.current
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center: initialCity.center,
      zoom: initialCity.zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    ;(window as unknown as { __LIFEFLOW_MAP__?: maplibregl.Map }).__LIFEFLOW_MAP__ = map

    map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'bottom-left')

    map.on('load', () => {
      tuneBasemap(map)
      registerPoiIcons(map)
      registerHousingMarkerImages(map)
      addPoiLayers(map)
      addHousingLayers(map)
      addRouteLayers(map)
      addSelectedPoiLayers(map)
      addHousingInteractionLayers(map)
      setMapReady(true)
      reportViewport(map, viewportHandlerRef.current)
    })

    map.on('moveend', () => reportViewport(map, viewportHandlerRef.current))

    map.on('error', (event) => {
      if (reportedStyleError) return
      reportedStyleError = true
      const detail = event.error?.message ? ` ${event.error.message}` : ''
      errorHandlerRef.current(`Không tải được một phần bản đồ.${detail}`)
    })

    map.on('click', MAP_LAYER_IDS.cluster, async (event) => {
      const feature = event.features?.[0]
      const clusterId = Number(feature?.properties?.cluster_id)
      const coordinates = getFeaturePoint(feature)
      const source = map.getSource(MAP_LAYER_IDS.poiSource) as GeoJSONSource | undefined
      if (!source || !coordinates || !Number.isFinite(clusterId)) return

      try {
        const zoom = await source.getClusterExpansionZoom(clusterId)
        map.easeTo({ center: coordinates, zoom })
      } catch {
        errorHandlerRef.current('Không thể mở cụm POI này.')
      }
    })

    map.on('click', MAP_LAYER_IDS.poi, (event) => {
      const feature = event.features?.[0]
      const coordinate = getFeaturePoint(feature)
      if (!feature || !coordinate) return
      setSelectedPoi(map, {
        type: 'Feature',
        id: feature.id,
        geometry: { type: 'Point', coordinates: coordinate },
        properties: (feature.properties || {}) as PoiProperties,
      })
      openPoiPopup(
        map,
        activePopupRef,
        coordinate,
        (feature.properties || {}) as PoiProperties,
      )
    })

    map.on('click', MAP_LAYER_IDS.housing, (event) => {
      const feature = event.features?.[0]
      const coordinate = getFeaturePoint(feature)
      if (!feature || !coordinate) return
      setSelectedPoi(map, null)
      closePopup(activePopupRef)
      housingSelectHandlerRef.current({
        type: 'Feature',
        id: feature.id,
        geometry: { type: 'Point', coordinates: coordinate },
        properties: feature.properties as HousingMapProperties,
      })
    })

    map.on('click', MAP_LAYER_IDS.housingCluster, (event) => {
      const coordinate = getFeaturePoint(event.features?.[0])
      if (!coordinate) return
      map.easeTo({ center: coordinate, zoom: Math.min(map.getZoom() + 2, 14) })
    })

    for (const layer of [MAP_LAYER_IDS.cluster, MAP_LAYER_IDS.poi, MAP_LAYER_IDS.housingCluster, MAP_LAYER_IDS.housing]) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    map.on('mousemove', MAP_LAYER_IDS.poi, (event) => {
      const feature = event.features?.[0]
      if (hoveredPoiRef.current !== null) {
        map.setFeatureState(
          { source: MAP_LAYER_IDS.poiSource, id: hoveredPoiRef.current },
          { hover: false },
        )
      }
      hoveredPoiRef.current = feature?.id ?? null
      if (hoveredPoiRef.current !== null) {
        map.setFeatureState(
          { source: MAP_LAYER_IDS.poiSource, id: hoveredPoiRef.current },
          { hover: true },
        )
      }
    })
    map.on('mouseleave', MAP_LAYER_IDS.poi, () => {
      if (hoveredPoiRef.current !== null) {
        map.setFeatureState(
          { source: MAP_LAYER_IDS.poiSource, id: hoveredPoiRef.current },
          { hover: false },
        )
      }
      hoveredPoiRef.current = null
    })

    map.on('mousemove', MAP_LAYER_IDS.housing, (event) => {
      const feature = event.features?.[0]
      const coordinate = getFeaturePoint(feature)
      if (!feature || !coordinate) return
      const listingId = String(feature.properties?.listing_id || '')
      if (hoveredHousingIdRef.current === listingId) return
      hoveredHousingIdRef.current = listingId
      housingHoverHandlerRef.current({
        type: 'Feature',
        id: feature.id,
        geometry: { type: 'Point', coordinates: coordinate },
        properties: feature.properties as HousingMapProperties,
      })
    })
    map.on('mouseleave', MAP_LAYER_IDS.housing, () => {
      hoveredHousingIdRef.current = null
      housingHoverHandlerRef.current(null)
    })

    map.on('click', (event) => {
      const interactiveLayers = [MAP_LAYER_IDS.cluster, MAP_LAYER_IDS.poi, MAP_LAYER_IDS.housingCluster, MAP_LAYER_IDS.housing]
        .filter((layer) => map.getLayer(layer))
      if (interactiveLayers.length) {
        const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers })
        if (features.length) return
      }
      setSelectedPoi(map, null)
      if (routePickingRef.current) pointHandlerRef.current([event.lngLat.lng, event.lngLat.lat])
      else mapBackgroundHandlerRef.current()
    })

    return () => {
      markerRefs.current.forEach((marker) => marker.remove())
      markerRefs.current = []
      closePopup(activePopupRef)
      map.remove()
      mapRef.current = null
      delete (window as unknown as { __LIFEFLOW_MAP__?: maplibregl.Map }).__LIFEFLOW_MAP__
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    closePopup(activePopupRef)
    setSelectedPoi(map, null)
    map.flyTo({ center: city.center, zoom: city.zoom, duration: 900, essential: true })
  }, [city, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(MAP_LAYER_IDS.poiSource) as GeoJSONSource | undefined
    source?.setData(pois || EMPTY_COLLECTION)
  }, [mapReady, pois])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(MAP_LAYER_IDS.housingSource) as GeoJSONSource | undefined
    source?.setData(housing || EMPTY_HOUSING)
  }, [housing, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    setHousingInteraction(map, selectedHousing, hoveredHousing)
  }, [hoveredHousing, mapReady, selectedHousing])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const visibility = showPois ? 'visible' : 'none'
    for (const layer of [MAP_LAYER_IDS.cluster, MAP_LAYER_IDS.poiHover, MAP_LAYER_IDS.poi]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visibility)
    }
    if (!showPois) {
      setSelectedPoi(map, null)
      closePopup(activePopupRef)
    }
  }, [mapReady, showPois])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(MAP_LAYER_IDS.routeSource) as GeoJSONSource | undefined
    source?.setData(route?.geometry || { type: 'FeatureCollection', features: [] })

    if (route?.geometry.geometry.coordinates.length) {
      const bounds = route.geometry.geometry.coordinates.reduce(
        (currentBounds, coordinate) => currentBounds.extend(coordinate as Coordinates),
        new maplibregl.LngLatBounds(
          route.geometry.geometry.coordinates[0] as Coordinates,
          route.geometry.geometry.coordinates[0] as Coordinates,
        ),
      )
      map.fitBounds(bounds, {
        padding: {
          top: 76,
          bottom: window.innerWidth < 760 ? 250 : 70,
          left: 70,
          right: window.innerWidth < 980 ? 70 : 360,
        },
        maxZoom: 15,
        duration: 900,
      })
    }
  }, [mapReady, route])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    markerRefs.current.forEach((marker) => marker.remove())
    markerRefs.current = points.map((point) => {
      const element = document.createElement('div')
      element.className = `route-marker route-marker--${point.label.toLowerCase()}`
      element.setAttribute('aria-label', `Điểm ${point.label}`)
      const label = document.createElement('span')
      label.textContent = point.label
      element.append(label)
      return new maplibregl.Marker({ element, anchor: 'bottom' })
        .setLngLat(point.coordinate)
        .addTo(map)
    })
  }, [mapReady, points])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !focusRequest) return
    const coordinate = focusRequest.poi.geometry.coordinates as Coordinates
    setSelectedPoi(map, focusRequest.poi)
    map.flyTo({
      center: coordinate,
      zoom: Math.max(
        map.getZoom(),
        focusRequest.poi.properties?.entity_kind === 'housing' ? 14.5 : MAP_ZOOM_RULES.selectedZoom,
      ),
      duration: 850,
    })
    const properties = focusRequest.poi.properties || {}
    if (properties.entity_kind === 'housing') {
      closePopup(activePopupRef)
      setSelectedPoi(map, null)
    } else {
      openPoiPopup(map, activePopupRef, coordinate, properties)
    }
  }, [focusRequest, mapReady])

  return (
    <section className="map-shell" aria-label={`Bản đồ ${city.label}`}>
      <div className="map-canvas" ref={containerRef} />
      {!mapReady && <div className="map-loading">Đang tải bản đồ…</div>}
    </section>
  )
}

function addPoiLayers(map: maplibregl.Map) {
  map.addSource(MAP_LAYER_IDS.poiSource, {
    type: 'geojson',
    data: EMPTY_COLLECTION,
    cluster: true,
    clusterMaxZoom: MAP_ZOOM_RULES.clusterMaxZoom,
    clusterRadius: 48,
    generateId: true,
  })
  map.addLayer({
    id: MAP_LAYER_IDS.cluster,
    type: 'symbol',
    source: MAP_LAYER_IDS.poiSource,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 10,
      'text-font': ['Noto Sans Regular'],
      'text-allow-overlap': false,
      'text-padding': 12,
      'symbol-sort-key': [
        'step',
        ['get', 'point_count'],
        3,
        40,
        2,
        180,
        1,
      ],
    },
    paint: {
      'text-color': MAP_THEME.cluster.text,
      'text-halo-color': [
        'step',
        ['get', 'point_count'],
        MAP_THEME.cluster.low,
        40,
        MAP_THEME.cluster.medium,
        180,
        MAP_THEME.cluster.high,
      ],
      'text-halo-width': 8,
      'text-halo-blur': 0.15,
      'text-opacity': 0.78,
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.clusterCount,
    type: 'symbol',
    source: MAP_LAYER_IDS.poiSource,
    filter: ['has', 'point_count'],
    layout: {
      visibility: 'none',
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.poiHover,
    type: 'circle',
    source: MAP_LAYER_IDS.poiSource,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 18, 0],
      'circle-color': 'rgba(99, 166, 233, 0.14)',
      'circle-stroke-color': 'rgba(52, 127, 214, 0.38)',
      'circle-stroke-width': 1.5,
      'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.poi,
    type: 'symbol',
    source: MAP_LAYER_IDS.poiSource,
    minzoom: MAP_ZOOM_RULES.individualPoiMinZoom,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': POI_ICON_EXPRESSION,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.58, 15, 0.8, 18, 0.96],
      'icon-anchor': 'center',
      'icon-allow-overlap': false,
      'icon-padding': 9,
      'symbol-sort-key': [
        'match',
        ['get', 'category'],
        ['hospital', 'university', 'shopping_mall', 'airport'],
        1,
        5,
      ],
    },
  })
}

function addRouteLayers(map: maplibregl.Map) {
  map.addSource(MAP_LAYER_IDS.routeSource, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.routeCasing,
    type: 'line',
    source: MAP_LAYER_IDS.routeSource,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.routeCasing,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 11],
      'line-opacity': 0.96,
      'line-blur': 0.35,
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.route,
    type: 'line',
    source: MAP_LAYER_IDS.routeSource,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.route,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 6.5],
      'line-opacity': 0.98,
    },
  })
}

function addHousingLayers(map: maplibregl.Map) {
  map.addSource(MAP_LAYER_IDS.housingSource, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.housingCluster,
    type: 'symbol',
    source: MAP_LAYER_IDS.housingSource,
    filter: ['==', ['get', 'entity_kind'], 'housing_cluster'],
    layout: {
      'text-field': ['to-string', ['get', 'cluster_count']],
      'text-size': 13,
      'text-font': ['Noto Sans Regular'],
      'text-allow-overlap': false,
      'text-padding': 18,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': MAP_THEME.categories.housing,
      'text-halo-width': 11.5,
      'text-halo-blur': 0.12,
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.housingClusterCount,
    type: 'symbol',
    source: MAP_LAYER_IDS.housingSource,
    filter: ['==', ['get', 'entity_kind'], 'housing_cluster'],
    layout: {
      visibility: 'none',
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.housing,
    type: 'symbol',
    source: MAP_LAYER_IDS.housingSource,
    minzoom: 11,
    filter: ['==', ['get', 'entity_kind'], 'housing'],
    layout: {
      'icon-image': HOUSING_PILL_IMAGE,
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [7, 11, 7, 11],
      'icon-allow-overlap': false,
      'text-field': HOUSING_PRICE_EXPRESSION,
      'text-size': 12.3,
      'text-font': ['Noto Sans Regular'],
      'text-padding': 18,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': [
        'case',
        ['==', ['get', 'location_accuracy'], 'approximate'],
        '#8b5e45',
        MAP_THEME.housingMarker.text,
      ],
      'text-halo-width': 0,
    },
  })
}

function addHousingInteractionLayers(map: maplibregl.Map) {
  map.addSource(MAP_LAYER_IDS.housingInteractionSource, {
    type: 'geojson',
    data: EMPTY_HOUSING_INTERACTION,
  })
  map.addLayer({
    id: MAP_LAYER_IDS.housingHover,
    type: 'symbol',
    source: MAP_LAYER_IDS.housingInteractionSource,
    filter: ['==', ['get', 'interaction_state'], 'hover'],
    layout: {
      'icon-image': HOUSING_PILL_HOVER_IMAGE,
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [8, 12, 8, 12],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': HOUSING_PRICE_EXPRESSION,
      'text-size': 13,
      'text-font': ['Noto Sans Regular'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': MAP_THEME.primaryDark,
      'text-halo-width': 0,
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.housingSelected,
    type: 'symbol',
    source: MAP_LAYER_IDS.housingInteractionSource,
    filter: ['==', ['get', 'interaction_state'], 'selected'],
    layout: {
      'icon-image': HOUSING_PILL_SELECTED_IMAGE,
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [9, 13, 9, 13],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': HOUSING_PRICE_EXPRESSION,
      'text-size': 13.5,
      'text-font': ['Noto Sans Regular'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-width': 0,
    },
  })
}

function addSelectedPoiLayers(map: maplibregl.Map) {
  map.addSource(MAP_LAYER_IDS.selectedSource, {
    type: 'geojson',
    data: EMPTY_SELECTED,
  })
  map.addLayer({
    id: MAP_LAYER_IDS.selectedHalo,
    type: 'circle',
    source: MAP_LAYER_IDS.selectedSource,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 16, 22],
      'circle-color': 'rgba(255, 255, 255, 0.9)',
      'circle-stroke-color': MAP_THEME.selected,
      'circle-stroke-width': 3,
    },
  })
  map.addLayer({
    id: MAP_LAYER_IDS.selected,
    type: 'symbol',
    source: MAP_LAYER_IDS.selectedSource,
    layout: {
      'icon-image': POI_ICON_EXPRESSION,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.68, 16, 0.92],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
}

function registerPoiIcons(map: maplibregl.Map) {
  for (const [group, iconName] of Object.entries(POI_ICON_NAME) as [PoiGroup, string][]) {
    if (map.hasImage(iconName)) continue
    map.addImage(iconName, createPoiIcon(group, MAP_THEME.categories[group]), { pixelRatio: 2 })
  }
}

function createPoiIcon(group: PoiGroup, color: string) {
  const size = 56
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể tạo POI icon canvas.')

  context.shadowColor = 'rgba(25, 39, 54, 0.18)'
  context.shadowBlur = 5
  context.shadowOffsetY = 1.5
  context.fillStyle = color
  context.beginPath()
  context.arc(28, 27, 19.5, 0, Math.PI * 2)
  context.fill()
  context.shadowColor = 'transparent'
  context.strokeStyle = MAP_THEME.poiBorder
  context.lineWidth = 3
  context.stroke()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = 3
  context.strokeStyle = '#ffffff'
  context.fillStyle = '#ffffff'

  drawGroupGlyph(context, group)
  return context.getImageData(0, 0, size, size)
}

function drawGroupGlyph(context: CanvasRenderingContext2D, group: PoiGroup) {
  if (group === 'healthcare') {
    context.fillRect(25, 16, 6, 22)
    context.fillRect(17, 24, 22, 6)
    return
  }
  if (group === 'accommodation') {
    context.strokeRect(17, 22, 22, 12)
    context.beginPath()
    context.moveTo(17, 18)
    context.lineTo(17, 38)
    context.moveTo(39, 22)
    context.lineTo(39, 38)
    context.moveTo(20, 22)
    context.lineTo(20, 19)
    context.lineTo(27, 19)
    context.lineTo(27, 22)
    context.stroke()
    return
  }
  if (group === 'shopping') {
    context.strokeRect(18, 21, 20, 17)
    context.beginPath()
    context.arc(28, 22, 7, Math.PI, 0)
    context.stroke()
    return
  }
  if (group === 'education') {
    context.beginPath()
    context.moveTo(15, 23)
    context.lineTo(28, 17)
    context.lineTo(41, 23)
    context.lineTo(28, 29)
    context.closePath()
    context.stroke()
    context.beginPath()
    context.moveTo(20, 27)
    context.lineTo(20, 34)
    context.quadraticCurveTo(28, 39, 36, 34)
    context.lineTo(36, 27)
    context.stroke()
    return
  }
  if (group === 'food') {
    context.beginPath()
    context.moveTo(20, 17)
    context.lineTo(20, 38)
    context.moveTo(16, 17)
    context.lineTo(16, 25)
    context.quadraticCurveTo(20, 29, 24, 25)
    context.lineTo(24, 17)
    context.moveTo(35, 17)
    context.lineTo(35, 38)
    context.moveTo(35, 17)
    context.quadraticCurveTo(42, 24, 35, 29)
    context.stroke()
    return
  }
  if (group === 'transport') {
    context.strokeRect(17, 17, 22, 20)
    context.beginPath()
    context.moveTo(20, 24)
    context.lineTo(36, 24)
    context.stroke()
    context.beginPath()
    context.arc(22, 37, 2.5, 0, Math.PI * 2)
    context.arc(34, 37, 2.5, 0, Math.PI * 2)
    context.fill()
    return
  }
  if (group === 'utility') {
    context.beginPath()
    context.moveTo(17, 37)
    context.lineTo(39, 37)
    context.moveTo(20, 33)
    context.lineTo(20, 25)
    context.moveTo(28, 33)
    context.lineTo(28, 25)
    context.moveTo(36, 33)
    context.lineTo(36, 25)
    context.moveTo(16, 23)
    context.lineTo(28, 17)
    context.lineTo(40, 23)
    context.closePath()
    context.stroke()
    return
  }
  context.beginPath()
  context.moveTo(16, 24)
  context.lineTo(16, 32)
  context.moveTo(20, 21)
  context.lineTo(20, 35)
  context.moveTo(20, 28)
  context.lineTo(36, 28)
  context.moveTo(36, 21)
  context.lineTo(36, 35)
  context.moveTo(40, 24)
  context.lineTo(40, 32)
  context.stroke()
}

function tuneBasemap(map: maplibregl.Map) {
  const noisyLabelPattern = /(poi|shop|restaurant|cafe|bar|lodging|transit|bus_stop)/i
  for (const layer of map.getStyle().layers || []) {
    try {
      if (layer.type === 'symbol' && noisyLabelPattern.test(layer.id)) {
        map.setLayoutProperty(layer.id, 'visibility', 'none')
      }
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', MAP_THEME.basemap.land)
      }
      if (layer.type === 'fill' && layer.id === 'landuse_residential') {
        map.setPaintProperty(layer.id, 'fill-color', MAP_THEME.basemap.residential)
        map.setPaintProperty(layer.id, 'fill-opacity', 0.9)
      }
      if (layer.type === 'fill' && layer.id === 'building') {
        map.setPaintProperty(layer.id, 'fill-color', MAP_THEME.basemap.building)
        map.setPaintProperty(layer.id, 'fill-outline-color', MAP_THEME.basemap.buildingOutline)
        map.setPaintProperty(layer.id, 'fill-opacity', 0.34)
      }
      if (layer.type === 'fill' && layer.id === 'water') {
        map.setPaintProperty(layer.id, 'fill-color', MAP_THEME.basemap.water)
        map.setPaintProperty(layer.id, 'fill-opacity', 1)
      }
      if (layer.type === 'fill' && layer.id === 'park') {
        map.setPaintProperty(layer.id, 'fill-color', MAP_THEME.basemap.park)
        map.setPaintProperty(layer.id, 'fill-opacity', 1)
      }
      if (layer.type === 'fill' && layer.id === 'landcover_wood') {
        map.setPaintProperty(layer.id, 'fill-color', MAP_THEME.basemap.wood)
        map.setPaintProperty(layer.id, 'fill-opacity', 0.92)
      }
      if (layer.type === 'line' && layer.id === 'waterway') {
        map.setPaintProperty(layer.id, 'line-color', MAP_THEME.basemap.waterway)
        map.setPaintProperty(layer.id, 'line-opacity', 1)
      }
      if (layer.type === 'line' && /^(highway_minor|highway_path)$/.test(layer.id)) {
        map.setPaintProperty(layer.id, 'line-color', MAP_THEME.basemap.minorRoad)
        map.setPaintProperty(layer.id, 'line-opacity', 0.88)
      }
      if (layer.type === 'line' && /^highway_major_(casing|subtle)$/.test(layer.id)) {
        map.setPaintProperty(layer.id, 'line-color', MAP_THEME.basemap.majorRoad)
      }
      if (layer.type === 'line' && layer.id === 'highway_major_inner') {
        map.setPaintProperty(layer.id, 'line-color', MAP_THEME.basemap.roadInner)
      }
      if (layer.type === 'line' && /^highway_motorway_(inner|subtle)$/.test(layer.id)) {
        map.setPaintProperty(layer.id, 'line-color', MAP_THEME.basemap.motorway)
      }
      if (layer.type === 'line' && layer.id === 'highway_motorway_casing') {
        map.setPaintProperty(layer.id, 'line-color', MAP_THEME.basemap.majorRoad)
      }
      if (layer.type === 'symbol' && /(road|place|settlement)/i.test(layer.id)) {
        map.setPaintProperty(layer.id, 'text-opacity', 0.88)
      }
    } catch {
      // OpenFreeMap layer names may change; unsupported overrides are cosmetic.
    }
  }
}

function setSelectedPoi(map: maplibregl.Map, poi: PoiFeature | null) {
  const source = map.getSource(MAP_LAYER_IDS.selectedSource) as GeoJSONSource | undefined
  if (!source) return
  source.setData(
    poi
      ? { type: 'FeatureCollection', features: [poi] }
      : EMPTY_SELECTED,
  )
}

function getFeaturePoint(feature?: MapGeoJSONFeature): Coordinates | null {
  if (!feature || feature.geometry.type !== 'Point') return null
  const [lng, lat] = feature.geometry.coordinates
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
}

function openPoiPopup(
  map: maplibregl.Map,
  popupRef: MutableRefObject<ActivePopup | null>,
  coordinate: Coordinates,
  properties: PoiProperties,
) {
  closePopup(popupRef)
  const container = document.createElement('div')
  const root = createRoot(container)
  root.render(<PoiPopup properties={properties} />)

  const popup = new maplibregl.Popup({ offset: 14, maxWidth: '320px' })
    .setLngLat(coordinate)
    .setDOMContent(container)
    .addTo(map)

  popupRef.current = { popup, root }
  popup.on('close', () => {
    if (popupRef.current?.popup === popup) {
      root.unmount()
      popupRef.current = null
    }
  })
}

function closePopup(popupRef: MutableRefObject<ActivePopup | null>) {
  const active = popupRef.current
  if (!active) return
  popupRef.current = null
  active.popup.remove()
  active.root.unmount()
}

function registerHousingMarkerImages(map: maplibregl.Map) {
  const markers = [
    [HOUSING_PILL_IMAGE, MAP_THEME.housingMarker.fill, MAP_THEME.housingMarker.border, 'rgba(24, 92, 86, 0.28)', 4.5],
    [HOUSING_PILL_HOVER_IMAGE, MAP_THEME.housingMarker.hoverFill, MAP_THEME.primaryDark, 'rgba(194, 65, 12, 0.26)', 3.5],
    [HOUSING_PILL_SELECTED_IMAGE, MAP_THEME.primary, MAP_THEME.primaryDark, 'rgba(194, 65, 12, 0.28)', 3.5],
  ] as const
  for (const [name, fill, border, shadow, borderWidth] of markers) {
    if (map.hasImage(name)) continue
    map.addImage(name, createPricePillImage(fill, border, shadow, borderWidth), {
      pixelRatio: 2,
      stretchX: [[28, 92]],
      stretchY: [[22, 34]],
      content: [20, 12, 100, 44],
    })
  }
}

function createPricePillImage(fill: string, border: string, shadow: string, borderWidth: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 120
  canvas.height = 56
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể tạo housing price marker.')
  context.shadowColor = shadow
  context.shadowBlur = 7
  context.shadowOffsetY = 3
  context.fillStyle = fill
  context.strokeStyle = border
  context.lineWidth = borderWidth
  context.beginPath()
  context.roundRect(7, 6, 106, 42, 18)
  context.fill()
  context.shadowColor = 'transparent'
  context.stroke()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function setHousingInteraction(
  map: maplibregl.Map,
  selected: HousingFeature | null,
  hovered: HousingFeature | null,
) {
  const source = map.getSource(MAP_LAYER_IDS.housingInteractionSource) as GeoJSONSource | undefined
  if (!source) return
  const selectedId = selected?.properties.entity_kind === 'housing' ? selected.properties.listing_id : null
  const features: GeoJSON.Feature<GeoJSON.Point, HousingMapProperties & { interaction_state: 'hover' | 'selected' }>[] = []
  if (hovered?.properties.entity_kind === 'housing' && hovered.properties.listing_id !== selectedId) {
    features.push({
      type: 'Feature',
      id: `hover:${hovered.properties.listing_id}`,
      geometry: hovered.geometry,
      properties: { ...hovered.properties, interaction_state: 'hover' },
    })
  }
  if (selected?.properties.entity_kind === 'housing') {
    features.push({
      type: 'Feature',
      id: `selected:${selected.properties.listing_id}`,
      geometry: selected.geometry,
      properties: { ...selected.properties, interaction_state: 'selected' },
    })
  }
  source.setData({ type: 'FeatureCollection', features })
}

function reportViewport(map: maplibregl.Map, callback: (viewport: HousingViewport) => void) {
  const bounds = map.getBounds()
  callback({
    boundingBox: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
    zoom: map.getZoom(),
  })
}
