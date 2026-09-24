import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl'
import { BASEMAP_STYLE_URL } from '../config/cities'
import type {
  CityConfig,
  Coordinates,
  PoiCollection,
  PoiFeature,
  PoiProperties,
  RoutePoint,
  RouteResult,
} from '../types'
import { PoiPopup } from './PoiPopup'

const EMPTY_COLLECTION: PoiCollection = { type: 'FeatureCollection', features: [] }
const POI_SOURCE = 'lifeflow-pois'
const CLUSTER_LAYER = 'poi-clusters'
const CLUSTER_COUNT_LAYER = 'poi-cluster-count'
const POI_LAYER = 'poi-points'
const ROUTE_SOURCE = 'lifeflow-route'
const ROUTE_CASING_LAYER = 'route-casing'
const ROUTE_LAYER = 'route-line'

interface FocusRequest {
  poi: PoiFeature
  token: number
}

interface MapViewProps {
  city: CityConfig
  pois: PoiCollection | null
  points: RoutePoint[]
  route: RouteResult | null
  focusRequest: FocusRequest | null
  onMapPoint: (coordinate: Coordinates) => void
  onMapError: (message: string) => void
}

interface ActivePopup {
  popup: maplibregl.Popup
  root: Root
}

export function MapView({
  city,
  pois,
  points,
  route,
  focusRequest,
  onMapPoint,
  onMapError,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRefs = useRef<maplibregl.Marker[]>([])
  const activePopupRef = useRef<ActivePopup | null>(null)
  const initialCityRef = useRef(city)
  const pointHandlerRef = useRef(onMapPoint)
  const errorHandlerRef = useRef(onMapError)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    pointHandlerRef.current = onMapPoint
  }, [onMapPoint])

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

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left')

    map.on('load', () => {
      addPoiLayers(map)
      addRouteLayers(map)
      setMapReady(true)
    })

    map.on('error', (event) => {
      if (reportedStyleError) return
      reportedStyleError = true
      const detail = event.error?.message ? ` ${event.error.message}` : ''
      errorHandlerRef.current(`Không tải được một phần bản đồ.${detail}`)
    })

    map.on('click', CLUSTER_LAYER, async (event) => {
      const feature = event.features?.[0]
      const clusterId = Number(feature?.properties?.cluster_id)
      const coordinates = getFeaturePoint(feature)
      const source = map.getSource(POI_SOURCE) as GeoJSONSource | undefined
      if (!source || !coordinates || !Number.isFinite(clusterId)) return

      try {
        const zoom = await source.getClusterExpansionZoom(clusterId)
        map.easeTo({ center: coordinates, zoom })
      } catch {
        errorHandlerRef.current('Không thể mở cụm POI này.')
      }
    })

    map.on('click', POI_LAYER, (event) => {
      const feature = event.features?.[0]
      const coordinate = getFeaturePoint(feature)
      if (!feature || !coordinate) return
      openPoiPopup(
        map,
        activePopupRef,
        coordinate,
        (feature.properties || {}) as PoiProperties,
      )
    })

    for (const layer of [CLUSTER_LAYER, POI_LAYER]) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    map.on('click', (event) => {
      const interactiveLayers = [CLUSTER_LAYER, POI_LAYER].filter((layer) => map.getLayer(layer))
      if (interactiveLayers.length) {
        const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers })
        if (features.length) return
      }
      pointHandlerRef.current([event.lngLat.lng, event.lngLat.lat])
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
    map.flyTo({ center: city.center, zoom: city.zoom, duration: 900, essential: true })
  }, [city, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(POI_SOURCE) as GeoJSONSource | undefined
    source?.setData(pois || EMPTY_COLLECTION)
  }, [mapReady, pois])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
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
    map.flyTo({ center: coordinate, zoom: Math.max(map.getZoom(), 15), duration: 850 })
    openPoiPopup(
      map,
      activePopupRef,
      coordinate,
      focusRequest.poi.properties || {},
    )
  }, [focusRequest, mapReady])

  return (
    <section className="map-shell" aria-label={`Bản đồ ${city.label}`}>
      <div className="map-canvas" ref={containerRef} />
      {!mapReady && <div className="map-loading">Đang tải bản đồ…</div>}
    </section>
  )
}

function addPoiLayers(map: maplibregl.Map) {
  map.addSource(POI_SOURCE, {
    type: 'geojson',
    data: EMPTY_COLLECTION,
    cluster: true,
    clusterMaxZoom: 13,
    clusterRadius: 48,
  })
  map.addLayer({
    id: CLUSTER_LAYER,
    type: 'circle',
    source: POI_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['step', ['get', 'point_count'], '#1f8a78', 25, '#17675f', 100, '#d28b32'],
      'circle-radius': ['step', ['get', 'point_count'], 17, 25, 21, 100, 26],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.92,
    },
  })
  map.addLayer({
    id: CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: POI_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': ['Noto Sans Regular'],
    },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({
    id: POI_LAYER,
    type: 'circle',
    source: POI_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'match',
        ['get', 'tourism'],
        'hotel',
        '#e09b38',
        'hostel',
        '#3d7fa0',
        'guest_house',
        '#7466a8',
        '#cf5b57',
      ],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 15, 7],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  })
}

function addRouteLayers(map: maplibregl.Map) {
  map.addSource(ROUTE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: ROUTE_CASING_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.92 },
  })
  map.addLayer({
    id: ROUTE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#16796c', 'line-width': 5.5, 'line-opacity': 1 },
  })
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
