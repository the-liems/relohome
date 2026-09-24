import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Navigation2, X } from 'lucide-react'
import { CitySwitcher } from './components/CitySwitcher'
import { MapView } from './components/MapView'
import { RoutePanel } from './components/RoutePanel'
import { SearchBar } from './components/SearchBar'
import { CITY_CONFIG, isWithinBounds } from './config/cities'
import { fetchRoute } from './services/osrm'
import { loadPois } from './services/platform-poi'
import type {
  CityId,
  Coordinates,
  PoiCollection,
  PoiFeature,
  RoutePoint,
  RouteResult,
  RouteStatus,
} from './types'

function App() {
  const [cityId, setCityId] = useState<CityId>('hcm')
  const [pois, setPois] = useState<PoiCollection | null>(null)
  const [poiLoading, setPoiLoading] = useState(true)
  const [points, setPoints] = useState<RoutePoint[]>([])
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

  const poiCount = useMemo(
    () =>
      pois?.features.filter((feature) =>
        isWithinBounds(feature.geometry.coordinates as Coordinates, city),
      ).length || 0,
    [city, pois],
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
  }

  const calculateRoute = useCallback(
    async (start: Coordinates, end: Coordinates) => {
      routeRequestRef.current?.abort()
      const controller = new AbortController()
      routeRequestRef.current = controller
      setRouteStatus('loading')
      setRouteError('')

      try {
        const result = await fetchRoute(city.osrmBaseUrl, start, end, controller.signal)
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
    [city.osrmBaseUrl],
  )

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
          onSelect={(poi) => setFocusRequest({ poi, token: Date.now() })}
        />
        <CitySwitcher activeCity={cityId} onChange={changeCity} />
      </header>

      <main className="workspace">
        <MapView
          city={city}
          pois={pois}
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
          status={routeStatus}
          error={routeError}
          poiCount={poiCount}
          onReset={resetRoute}
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
