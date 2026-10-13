import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Home, MapPinned, Navigation2, X } from 'lucide-react'
import { CitySwitcher } from './components/CitySwitcher'
import { HousingDetailDrawer } from './components/HousingDetailDrawer'
import { HousingFilterBar, type HousingFilters } from './components/HousingFilterBar'
import { HousingResultsPanel } from './components/HousingResultsPanel'
import { isHousingListing } from './components/housing-ui'
import { MapView } from './components/MapView'
import { RoutePanel } from './components/RoutePanel'
import { SearchBar } from './components/SearchBar'
import { CITY_CONFIG, isWithinBounds } from './config/cities'
import { fetchRoute } from './services/osrm'
import { loadHousing } from './services/platform-housing'
import { loadPois } from './services/platform-poi'
import type {
  CityId,
  Coordinates,
  HousingCollection,
  HousingFeature,
  HousingMapProperties,
  HousingViewport,
  PoiCollection,
  PoiFeature,
  RoutePoint,
  RouteProfile,
  RouteResult,
  RouteStatus,
} from './types'

const RESULT_RENDER_LIMIT = 80
type HousingListingFeature = HousingFeature & { properties: HousingMapProperties }
const EMPTY_HOUSING_FILTERS: HousingFilters = {
  maxPrice: null,
  propertyType: null,
  minBedrooms: null,
  minArea: null,
  withImage: false,
}

function initialViewport(cityId: CityId): HousingViewport {
  const city = CITY_CONFIG[cityId]
  const [[west, south], [east, north]] = city.bounds
  return { boundingBox: { west, south, east, north }, zoom: city.zoom }
}

function App() {
  const [cityId, setCityId] = useState<CityId>('hcm')
  const [pois, setPois] = useState<PoiCollection | null>(null)
  const [housing, setHousing] = useState<HousingCollection | null>(null)
  const [poiLoading, setPoiLoading] = useState(true)
  const [housingLoading, setHousingLoading] = useState(true)
  const [housingViewport, setHousingViewport] = useState<HousingViewport>(() => initialViewport('hcm'))
  const [filters, setFilters] = useState<HousingFilters>(EMPTY_HOUSING_FILTERS)
  const [showPois, setShowPois] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(true)
  const [selectedHousing, setSelectedHousing] = useState<HousingListingFeature | null>(null)
  const [hoveredHousing, setHoveredHousing] = useState<HousingListingFeature | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [routeProfile, setRouteProfile] = useState<RouteProfile>('motorcycle')
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle')
  const [routeError, setRouteError] = useState('')
  const [routePanelOpen, setRoutePanelOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ poi: PoiFeature; token: number } | null>(null)
  const routeRequestRef = useRef<AbortController | null>(null)
  const city = CITY_CONFIG[cityId]
  const dataLoading = !pois && !housing

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadPois(city, controller.signal).then((result) => {
      if (active) setPois(result)
    }).catch((error) => {
      if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
        setNotice(error instanceof Error ? error.message : 'Không tải được dữ liệu tiện ích.')
      }
    }).finally(() => {
      if (active) setPoiLoading(false)
    })
    return () => { active = false; controller.abort() }
  }, [city])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      loadHousing(housingViewport, controller.signal).then((result) => {
        if (active) setHousing(result)
      }).catch((error) => {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setNotice(error instanceof Error ? error.message : 'Không tải được dữ liệu nhà ở.')
        }
      }).finally(() => {
        if (active) setHousingLoading(false)
      })
    }, 250)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [housingViewport])

  useEffect(() => () => routeRequestRef.current?.abort(), [])

  const housingListings = useMemo<HousingListingFeature[]>(
    () => (housing?.features.filter(isHousingListing) || []) as HousingListingFeature[],
    [housing],
  )
  const clusterMode = Boolean(housing?.features.some((feature) => feature.properties.entity_kind === 'housing_cluster'))

  const filteredListings = useMemo(() => housingListings.filter(({ properties }) => {
    if (filters.maxPrice !== null && properties.price_amount > filters.maxPrice) return false
    if (filters.propertyType !== null && properties.property_type !== filters.propertyType) return false
    if (filters.minBedrooms !== null && (properties.bedrooms === null || properties.bedrooms < filters.minBedrooms)) return false
    if (filters.minArea !== null && (properties.area_m2 === null || properties.area_m2 < filters.minArea)) return false
    if (filters.withImage && !properties.thumbnail_url) return false
    return true
  }), [filters, housingListings])

  const filteredHousing = useMemo<HousingCollection | null>(() => {
    if (!housing || clusterMode) return housing
    return { type: 'FeatureCollection', features: filteredListings }
  }, [clusterMode, filteredListings, housing])

  const visibleListings = useMemo(() => {
    const visible = filteredListings.slice(0, RESULT_RENDER_LIMIT)
    if (!selectedHousing || visible.some((item) => item.properties.listing_id === selectedHousing.properties.listing_id)) return visible
    const selectedStillMatches = filteredListings.some((item) => item.properties.listing_id === selectedHousing.properties.listing_id)
    return selectedStillMatches ? [selectedHousing, ...visible.slice(0, RESULT_RENDER_LIMIT - 1)] : visible
  }, [filteredListings, selectedHousing])

  const searchablePlaces = useMemo<PoiCollection | null>(() => {
    if (!pois && !filteredHousing) return null
    return {
      type: 'FeatureCollection',
      features: [
        ...(filteredHousing?.features.filter((feature) => feature.properties.entity_kind === 'housing') || []),
        ...(pois?.features || []),
      ],
    }
  }, [filteredHousing, pois])

  const poiCount = useMemo(
    () => pois?.features.filter((feature) => isWithinBounds(feature.geometry.coordinates as Coordinates, city)).length || 0,
    [city, pois],
  )
  const housingCount = clusterMode
    ? housing?.features.reduce((total, feature) => total + (feature.properties.entity_kind === 'housing_cluster' ? feature.properties.cluster_count : 1), 0) || 0
    : filteredListings.length
  const activeFilterCount = [filters.maxPrice, filters.propertyType, filters.minBedrooms, filters.minArea, filters.withImage].filter(Boolean).length

  const resetRoute = useCallback(() => {
    routeRequestRef.current?.abort()
    routeRequestRef.current = null
    setPoints([])
    setRoute(null)
    setRouteStatus('idle')
    setRouteError('')
  }, [])

  const changeCity = (nextCity: CityId) => {
    if (nextCity === cityId) return
    resetRoute()
    setRoutePanelOpen(false)
    setDetailOpen(false)
    setSelectedHousing(null)
    setHoveredHousing(null)
    setNotice('')
    setFocusRequest(null)
    setPoiLoading(true)
    setHousingLoading(true)
    setPois(null)
    setHousing(null)
    setHousingViewport(initialViewport(nextCity))
    setCityId(nextCity)
  }

  const calculateRoute = useCallback(async (start: Coordinates, end: Coordinates, profile = routeProfile) => {
    routeRequestRef.current?.abort()
    const controller = new AbortController()
    routeRequestRef.current = controller
    setRouteStatus('loading')
    setRouteError('')
    try {
      const result = await fetchRoute(city.osrmBaseUrls[profile], profile, start, end, controller.signal)
      setRoute(result)
      setRouteStatus('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setRoute(null)
      setRouteStatus('error')
      setRouteError(error instanceof Error ? error.message : 'Không thể kết nối dịch vụ định tuyến.')
    }
  }, [city.osrmBaseUrls, routeProfile])

  const changeRouteProfile = (nextProfile: RouteProfile) => {
    if (nextProfile === routeProfile) return
    setRouteProfile(nextProfile)
    setRoute(null)
    setRouteError('')
    if (points.length === 2) void calculateRoute(points[0].coordinate, points[1].coordinate, nextProfile)
    else setRouteStatus(points.length === 1 ? 'selecting-end' : 'idle')
  }

  const selectMapPoint = useCallback((coordinate: Coordinates) => {
    if (!routePanelOpen) return
    if (!isWithinBounds(coordinate, city)) {
      setRouteStatus('error')
      setRouteError(`Điểm đã chọn nằm ngoài vùng định tuyến ${city.label}.`)
      return
    }
    if (points.length >= 2) return
    if (points.length === 0) {
      setPoints([{ coordinate, label: 'A' }])
      setRoute(null)
      setRouteStatus('selecting-end')
      setRouteError('')
      return
    }
    const nextPoints: RoutePoint[] = [points[0], { coordinate, label: 'B' }]
    setPoints(nextPoints)
    void calculateRoute(nextPoints[0].coordinate, coordinate)
  }, [calculateRoute, city, points, routePanelOpen])

  const selectHousing = useCallback((feature: HousingListingFeature, focus = true) => {
    setSelectedHousing(feature)
    setDetailOpen(true)
    setRoutePanelOpen(false)
    if (focus) setFocusRequest({ poi: feature, token: Date.now() })
  }, [])

  const selectHousingFromMap = useCallback((feature: HousingListingFeature) => {
    const canonicalFeature = filteredListings.find(
      (item) => item.properties.listing_id === feature.properties.listing_id,
    ) || feature
    selectHousing(canonicalFeature, false)
  }, [filteredListings, selectHousing])

  const toggleSaved = (listingId: string) => {
    setSavedIds((current) => {
      const next = new Set(current)
      if (next.has(listingId)) next.delete(listingId)
      else next.add(listingId)
      return next
    })
  }

  const selectSearchResult = (poi: PoiFeature) => {
    if (poi.properties?.entity_kind === 'housing') {
      selectHousing(poi as HousingListingFeature)
      return
    }
    setShowPois(true)
    setDetailOpen(false)
    setSelectedHousing(null)
    setFocusRequest({ poi, token: Date.now() })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="ReloHome Map"><span className="brand-mark"><Navigation2 size={19} /></span><span><strong>ReloHome</strong><small>Nhà ở & vị trí</small></span></div>
        <SearchBar key={city.id} city={city} pois={searchablePlaces} loading={dataLoading} onSelect={selectSearchResult} />
        <CitySwitcher activeCity={cityId} onChange={changeCity} />
      </header>

      <main className={resultsOpen ? 'workspace' : 'workspace workspace--results-collapsed'}>
        <HousingResultsPanel listings={visibleListings} totalCount={housingCount} loading={housingLoading}
          clusterMode={clusterMode} open={resultsOpen} selectedId={selectedHousing?.properties.listing_id || null}
          hoveredId={hoveredHousing?.properties.listing_id || null} savedIds={savedIds} activeFilterCount={activeFilterCount}
          onToggle={() => setResultsOpen((current) => !current)} onResetFilters={() => setFilters(EMPTY_HOUSING_FILTERS)}
          onSelect={(feature) => selectHousing(feature)} onHover={setHoveredHousing} onToggleSave={toggleSaved} />

        <section className="map-stage">
          <MapView city={city} pois={pois} housing={filteredHousing} points={points} route={route}
            focusRequest={focusRequest} selectedHousing={selectedHousing} hoveredHousing={hoveredHousing}
            showPois={showPois} routePickingEnabled={routePanelOpen}
            onHousingSelect={selectHousingFromMap} onHousingHover={setHoveredHousing}
            onMapBackground={() => { setDetailOpen(false); setSelectedHousing(null) }} onMapPoint={selectMapPoint}
            onViewportChange={(viewport) => { setHousingLoading(true); setHousingViewport(viewport) }}
            onMapError={(message) => setNotice((current) => current || message)} />

          <HousingFilterBar filters={filters} disabled={clusterMode || housingListings.length === 0}
            showPois={showPois} onChange={setFilters} onReset={() => setFilters(EMPTY_HOUSING_FILTERS)}
            onTogglePois={() => setShowPois((current) => !current)} />

          <div className="map-summary" aria-label="Dữ liệu trong khu vực bản đồ">
            <span className="map-summary__item map-summary__item--housing"><Home size={16} /><span><strong>{housingLoading && housingCount === 0 ? '…' : housingCount.toLocaleString('vi-VN')}</strong> chỗ ở</span></span>
            {showPois && <><span className="map-summary__divider" /><span className="map-summary__item"><MapPinned size={16} /><span><strong>{poiLoading ? '…' : poiCount.toLocaleString('vi-VN')}</strong> tiện ích</span></span></>}
          </div>

          {selectedHousing && detailOpen ? (
            <HousingDetailDrawer feature={selectedHousing} saved={savedIds.has(selectedHousing.properties.listing_id)}
              showPois={showPois} onClose={() => setDetailOpen(false)} onToggleSave={() => toggleSaved(selectedHousing.properties.listing_id)}
              onRoute={() => { setDetailOpen(false); setRoutePanelOpen(true) }} onTogglePois={() => setShowPois((current) => !current)} />
          ) : (
            <RoutePanel city={city} points={points} route={route} profile={routeProfile} status={routeStatus}
              error={routeError} poiCount={poiCount} housingCount={housingCount} open={routePanelOpen}
              onToggle={() => setRoutePanelOpen((current) => !current)} onReset={resetRoute} onProfileChange={changeRouteProfile} />
          )}

          {notice && <div className="app-notice" role="alert"><AlertTriangle size={18} /><span>{notice}</span><button type="button" className="icon-button" title="Đóng thông báo" aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={16} /></button></div>}
        </section>
      </main>
    </div>
  )
}

export default App
