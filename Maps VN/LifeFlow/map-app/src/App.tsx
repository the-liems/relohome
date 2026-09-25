import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BedDouble, Bus, Dumbbell, GraduationCap, HeartPulse, Landmark, Layers, Navigation2, ShoppingBag, Utensils, X } from 'lucide-react'
import { CitySwitcher } from './components/CitySwitcher'
import { MapView } from './components/MapView'
import { RoutePanel } from './components/RoutePanel'
import { SearchBar } from './components/SearchBar'
import { CITY_CONFIG, isWithinBounds } from './config/cities'
import { POI_GROUPS, type PoiGroup } from './config/poi-groups'
import { fetchRoute } from './services/osrm'
import { loadPois } from './services/platform-poi'
import type {
  CityId,
  Coordinates,
  PoiCollection,
  PoiFeature,
  RoutePoint,
  RouteProfile,
  RouteResult,
  RouteStatus,
} from './types'

function App() {
  const [poiGroup, setPoiGroup] = useState<PoiGroup | 'all'>('all')
  const [cityId, setCityId] = useState<CityId>('hcm')
  const [pois, setPois] = useState<PoiCollection | null>(null)
  const [poiLoading, setPoiLoading] = useState(true)
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [routeProfile, setRouteProfile] = useState<RouteProfile>('driving')
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle')
  const [routeError, setRouteError] = useState('')
  const [notice, setNotice] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ poi: PoiFeature; token: number } | null>(null)
  const routeRequestRef = useRef<AbortController | null>(null)
  const city = CITY_CONFIG[cityId]

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadPois(city, controller.signal)
      .then((collection) => {
        if (active) setPois(collection)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (active) {
          setNotice(error instanceof Error ? error.message : 'Không tải được dữ liệu POI.')
        }
      })
      .finally(() => {
        if (active) setPoiLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [city])

  useEffect(
    () => () => {
      routeRequestRef.current?.abort()
    },
    [],
  )

  const visiblePois = useMemo(() => {
    if (!pois || poiGroup === 'all') return pois
    return { ...pois, features: pois.features.filter((feature) => feature.properties.group === poiGroup) }
  }, [pois, poiGroup])

  const poiCount = useMemo(
    () =>
      visiblePois?.features.filter((feature) =>
        isWithinBounds(feature.geometry.coordinates as Coordinates, city),
      ).length || 0,
    [city, visiblePois],
  )

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
    setNotice('')
    setFocusRequest(null)
    setPoiLoading(true)
    setPois(null)
    setCityId(nextCity)
    setPoiGroup('all')
  }

  const changePoiGroup = (nextGroup: PoiGroup | 'all') => {
    if (nextGroup === poiGroup) return
    setFocusRequest(null)
    setPoiGroup(nextGroup)
  }

  const calculateRoute = useCallback(
    async (start: Coordinates, end: Coordinates, profile = routeProfile) => {
      routeRequestRef.current?.abort()
      const controller = new AbortController()
      routeRequestRef.current = controller
      setRouteStatus('loading')
      setRouteError('')

      try {
        const result = await fetchRoute(
          city.osrmBaseUrls[profile],
          profile,
          start,
          end,
          controller.signal,
        )
        setRoute(result)
        setRouteStatus('ready')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setRoute(null)
        setRouteStatus('error')
        setRouteError(
          error instanceof Error
            ? error.message
            : 'Không thể kết nối dịch vụ định tuyến.',
        )
      }
    },
    [city.osrmBaseUrls, routeProfile],
  )

  const changeRouteProfile = (nextProfile: RouteProfile) => {
    if (nextProfile === routeProfile) return
    setRouteProfile(nextProfile)
    setRoute(null)
    setRouteError('')
    if (points.length === 2) {
      void calculateRoute(points[0].coordinate, points[1].coordinate, nextProfile)
    } else {
      setRouteStatus(points.length === 1 ? 'selecting-end' : 'idle')
    }
  }

  const selectMapPoint = useCallback(
    (coordinate: Coordinates) => {
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
    },
    [calculateRoute, city, points],
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="LifeFlow Map">
          <span className="brand-mark"><Navigation2 size={20} /></span>
          <span>
            <strong>LifeFlow</strong>
            <small>Map</small>
          </span>
        </div>
        <SearchBar
          key={city.id}
          city={city}
          pois={pois}
          loading={poiLoading}
          onSelect={(poi) => {
            setPoiGroup('all')
            setFocusRequest({ poi, token: Date.now() })
          }}
        />
        <CitySwitcher activeCity={cityId} onChange={changeCity} />
      </header>

      <nav className="poi-groups" aria-label="Nhóm địa điểm">
        <button
          type="button"
          className={poiGroup === 'all' ? 'poi-group is-active' : 'poi-group'}
          aria-pressed={poiGroup === 'all'}
          onClick={() => changePoiGroup('all')}
        >
          <Layers size={16} aria-hidden="true" />
          <span>Tất cả</span>
        </button>
        {(Object.keys(POI_GROUPS) as PoiGroup[]).map((group) => {
          const Icon = {
            accommodation: BedDouble,
            healthcare: HeartPulse,
            shopping: ShoppingBag,
            education: GraduationCap,
            food: Utensils,
            transport: Bus,
            utility: Landmark,
            lifestyle: Dumbbell,
          }[group]
          return (
            <button
              key={group}
              type="button"
              className={group === poiGroup ? 'poi-group is-active' : 'poi-group'}
              aria-pressed={group === poiGroup}
              onClick={() => changePoiGroup(group)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{POI_GROUPS[group].label}</span>
            </button>
          )
        })}
      </nav>

      <main className="workspace">
        <MapView
          city={city}
          pois={visiblePois}
          points={points}
          route={route}
          focusRequest={focusRequest}
          onMapPoint={selectMapPoint}
          onMapError={(message) => setNotice((current) => current || message)}
        />
        <RoutePanel
          city={city}
          points={points}
          route={route}
          profile={routeProfile}
          status={routeStatus}
          error={routeError}
          poiCount={poiCount}
          onReset={resetRoute}
          onProfileChange={changeRouteProfile}
        />

        {notice && (
          <div className="app-notice" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{notice}</span>
            <button
              type="button"
              className="icon-button"
              title="Đóng thông báo"
              aria-label="Đóng thông báo"
              onClick={() => setNotice('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
