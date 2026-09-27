import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Navigation2, X } from 'lucide-react'
import { CitySwitcher } from './components/CitySwitcher'
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
  PoiCollection,
  PoiFeature,
  RoutePoint,
  RouteProfile,
  RouteResult,
  RouteStatus,
} from './types'

function App() {
  const [cityId, setCityId] = useState<CityId>('hcm')
  const [pois, setPois] = useState<PoiCollection | null>(null)
  const [housing, setHousing] = useState<HousingCollection | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [routeProfile, setRouteProfile] = useState<RouteProfile>('motorcycle')
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
    Promise.allSettled([
      loadPois(city, controller.signal),
      loadHousing(city, controller.signal),
    ]).then(([poiResult, housingResult]) => {
      if (!active) return
      if (poiResult.status === 'fulfilled') setPois(poiResult.value)
      if (housingResult.status === 'fulfilled') setHousing(housingResult.value)

      const errors = [poiResult, housingResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
        .filter((error) => !(error instanceof DOMException && error.name === 'AbortError'))
      if (errors.length) {
        const error = errors[0]
        setNotice(error instanceof Error ? error.message : 'Không tải được dữ liệu bản đồ.')
      }
      setDataLoading(false)
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

  const searchablePlaces = useMemo<PoiCollection | null>(() => {
    if (!pois && !housing) return null
    return {
      type: 'FeatureCollection',
      features: [...(housing?.features || []), ...(pois?.features || [])],
    }
  }, [housing, pois])

  const poiCount = useMemo(
    () =>
      pois?.features.filter((feature) =>
        isWithinBounds(feature.geometry.coordinates as Coordinates, city),
      ).length || 0,
    [city, pois],
  )

  const housingCount = housing?.features.length || 0

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
    setDataLoading(true)
    setPois(null)
    setHousing(null)
    setCityId(nextCity)
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
          pois={searchablePlaces}
          loading={dataLoading}
          onSelect={(poi) => {
            setFocusRequest({ poi, token: Date.now() })
          }}
        />
        <CitySwitcher activeCity={cityId} onChange={changeCity} />
      </header>

      <main className="workspace">
        <MapView
          city={city}
          pois={pois}
          housing={housing}
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
          housingCount={housingCount}
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
