import {
  Bike,
  CarFront,
  ChevronLeft,
  Clock3,
  Flag,
  Footprints,
  MapPin,
  PanelRightClose,
  RotateCcw,
  Route,
  Ruler,
} from 'lucide-react'
import type { CityConfig, RoutePoint, RouteProfile, RouteResult, RouteStatus } from '../types'

interface RoutePanelProps {
  city: CityConfig
  points: RoutePoint[]
  route: RouteResult | null
  profile: RouteProfile
  status: RouteStatus
  error: string
  poiCount: number
  housingCount: number
  open: boolean
  onToggle: () => void
  onReset: () => void
  onProfileChange: (profile: RouteProfile) => void
}

function formatCoordinate([lng, lat]: [number, number]) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function RoutePanel({
  city,
  points,
  route,
  profile,
  status,
  error,
  poiCount,
  housingCount,
  open,
  onToggle,
  onReset,
  onProfileChange,
}: RoutePanelProps) {
  if (!open) {
    return (
      <aside className="route-panel route-panel--collapsed" aria-label="Chỉ đường">
        <button className="route-panel__launcher" type="button" onClick={onToggle}>
          <span className="route-panel__launcher-icon"><Route size={19} aria-hidden="true" /></span>
          <span>
            <strong>Chỉ đường</strong>
            <small>Chọn điểm A và B</small>
          </span>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="route-panel" aria-label="Thông tin tuyến đường">
      <div className="route-panel__title">
        <div>
          <span className="eyebrow">Di chuyển</span>
          <h2>Chỉ đường tại {city.label}</h2>
        </div>
        <div className="route-panel__actions">
          {points.length > 0 && (
            <button className="icon-button icon-button--bordered" type="button"
              title="Chọn lại điểm A và B" aria-label="Chọn lại điểm A và B" onClick={onReset}>
              <RotateCcw size={16} />
            </button>
          )}
          <button className="icon-button icon-button--bordered" type="button"
            title="Thu gọn chỉ đường" aria-label="Thu gọn chỉ đường" onClick={onToggle}>
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>

      <div className="route-profile" role="group" aria-label="Phương tiện di chuyển">
        <button type="button" className={profile === 'driving' ? 'is-active' : ''}
          title="Ô tô" aria-label="Ô tô" aria-pressed={profile === 'driving'}
          onClick={() => onProfileChange('driving')}>
          <CarFront size={17} aria-hidden="true" /><span>Ô tô</span>
        </button>
        <button type="button" className={profile === 'motorcycle' ? 'is-active' : ''}
          title="Xe máy" aria-label="Xe máy" aria-pressed={profile === 'motorcycle'}
          onClick={() => onProfileChange('motorcycle')}>
          <Bike size={17} aria-hidden="true" /><span>Xe máy</span>
        </button>
        <button type="button" className={profile === 'walking' ? 'is-active' : ''}
          title="Đi bộ" aria-label="Đi bộ" aria-pressed={profile === 'walking'}
          onClick={() => onProfileChange('walking')}>
          <Footprints size={17} aria-hidden="true" /><span>Đi bộ</span>
        </button>
      </div>

      <div className="route-points">
        <div className={points[0] ? 'route-point is-set' : 'route-point'}>
          <span className="point-badge point-badge--a">A</span>
          <div><strong>Điểm đi</strong><p>{points[0] ? formatCoordinate(points[0].coordinate) : 'Chọn trực tiếp trên bản đồ'}</p></div>
        </div>
        <div className={points[1] ? 'route-point is-set' : 'route-point'}>
          <span className="point-badge point-badge--b">B</span>
          <div><strong>Điểm đến</strong><p>{points[1] ? formatCoordinate(points[1].coordinate) : 'Chọn trực tiếp trên bản đồ'}</p></div>
        </div>
      </div>

      {status === 'idle' && <div className="route-state"><MapPin size={19} aria-hidden="true" /><p>Chọn điểm A trên bản đồ để bắt đầu.</p></div>}
      {status === 'selecting-end' && <div className="route-state route-state--active"><Flag size={19} aria-hidden="true" /><p>Đã chọn điểm A. Chọn tiếp điểm B.</p></div>}
      {status === 'loading' && <div className="route-state route-state--active"><span className="spinner" aria-hidden="true" /><p>Đang tính tuyến đường phù hợp…</p></div>}
      {status === 'error' && <div className="route-state route-state--error" role="alert"><p>{error}</p></div>}

      {status === 'ready' && route && (
        <div className="route-summary">
          <div><Ruler size={18} aria-hidden="true" /><span>Quãng đường</span><strong>{(route.distanceMeters / 1000).toFixed(1)} km</strong></div>
          <div><Clock3 size={18} aria-hidden="true" /><span>Thời gian</span><strong>{Math.max(1, Math.round(route.durationSeconds / 60))} phút</strong></div>
          <div className="route-ready"><Route size={18} aria-hidden="true" /><span>Đã tìm thấy tuyến đường phù hợp.</span></div>
        </div>
      )}

      <div className="route-panel__footer">
        <span>{housingCount.toLocaleString('vi-VN')} chỗ ở</span>
        <span>{poiCount.toLocaleString('vi-VN')} tiện ích</span>
      </div>
    </aside>
  )
}
