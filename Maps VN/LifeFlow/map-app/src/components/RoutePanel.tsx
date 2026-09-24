import { Clock3, Flag, MapPin, RotateCcw, Route, Ruler } from 'lucide-react'
import type { CityConfig, RoutePoint, RouteResult, RouteStatus } from '../types'

interface RoutePanelProps {
  city: CityConfig
  points: RoutePoint[]
  route: RouteResult | null
  status: RouteStatus
  error: string
  poiCount: number
  onReset: () => void
}

function formatCoordinate([lng, lat]: [number, number]) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function RoutePanel({
  city,
  points,
  route,
  status,
  error,
  poiCount,
  onReset,
}: RoutePanelProps) {
  return (
    <aside className="route-panel" aria-label="Thông tin tuyến đường">
      <div className="route-panel__title">
        <div>
          <span className="eyebrow">Tuyến đường</span>
          <h2>{city.label}</h2>
        </div>
        {points.length > 0 && (
          <button
            className="icon-button icon-button--bordered"
            type="button"
            title="Chọn lại điểm A và B"
            aria-label="Chọn lại điểm A và B"
            onClick={onReset}
          >
            <RotateCcw size={17} />
          </button>
        )}
      </div>

      <div className="route-points">
        <div className={points[0] ? 'route-point is-set' : 'route-point'}>
          <span className="point-badge point-badge--a">A</span>
          <div>
            <strong>Điểm đi</strong>
            <p>{points[0] ? formatCoordinate(points[0].coordinate) : 'Chọn trên bản đồ'}</p>
          </div>
        </div>
        <div className={points[1] ? 'route-point is-set' : 'route-point'}>
          <span className="point-badge point-badge--b">B</span>
          <div>
            <strong>Điểm đến</strong>
            <p>{points[1] ? formatCoordinate(points[1].coordinate) : 'Chọn trên bản đồ'}</p>
          </div>
        </div>
      </div>

      {status === 'idle' && (
        <div className="route-state">
          <MapPin size={19} aria-hidden="true" />
          <p>Chọn điểm A trên bản đồ.</p>
        </div>
      )}
      {status === 'selecting-end' && (
        <div className="route-state route-state--active">
          <Flag size={19} aria-hidden="true" />
          <p>Chọn tiếp điểm B.</p>
        </div>
      )}
      {status === 'loading' && (
        <div className="route-state route-state--active">
          <span className="spinner" aria-hidden="true" />
          <p>Đang tính tuyến đường…</p>
        </div>
      )}
      {status === 'error' && (
        <div className="route-state route-state--error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {status === 'ready' && route && (
        <div className="route-summary">
          <div>
            <Ruler size={18} aria-hidden="true" />
            <span>Quãng đường</span>
            <strong>{(route.distanceMeters / 1000).toFixed(1)} km</strong>
          </div>
          <div>
            <Clock3 size={18} aria-hidden="true" />
            <span>Thời gian</span>
            <strong>{Math.max(1, Math.round(route.durationSeconds / 60))} phút</strong>
          </div>
          <div className="route-ready">
            <Route size={18} aria-hidden="true" />
            <span>OSRM đã tìm thấy tuyến phù hợp.</span>
          </div>
        </div>
      )}

      <div className="route-panel__footer">
        <span>{poiCount.toLocaleString('vi-VN')} POI</span>
        <span>{new URL(city.osrmBaseUrl).port}</span>
      </div>
    </aside>
  )
}
