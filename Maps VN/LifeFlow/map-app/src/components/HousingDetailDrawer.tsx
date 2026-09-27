import { Bath, BedDouble, ExternalLink, Heart, House, MapPin, MapPinned, Navigation, Ruler, X } from 'lucide-react'
import type { HousingFeature, HousingMapProperties } from '../types'
import { amenityLabel, propertyLabel } from './housing-ui'

interface HousingDetailDrawerProps {
  feature: HousingFeature & { properties: HousingMapProperties }
  saved: boolean
  showPois: boolean
  onClose: () => void
  onToggleSave: () => void
  onRoute: () => void
  onTogglePois: () => void
}

export function HousingDetailDrawer({ feature, saved, showPois, onClose, onToggleSave, onRoute, onTogglePois }: HousingDetailDrawerProps) {
  const housing = feature.properties
  return (
    <aside className="housing-detail" aria-label={`Chi tiết ${housing.title}`}>
      <div className="housing-detail__media">
        {housing.thumbnail_url ? <img src={housing.thumbnail_url} alt={housing.title} /> : <span><House size={42} /></span>}
        <button type="button" className="housing-detail__close" aria-label="Đóng chi tiết" onClick={onClose}><X size={18} /></button>
        <button type="button" className={saved ? 'housing-detail__save is-saved' : 'housing-detail__save'}
          aria-label={saved ? 'Bỏ lưu nhà ở' : 'Lưu nhà ở'} aria-pressed={saved} onClick={onToggleSave}>
          <Heart size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="housing-detail__body">
        <span className="housing-detail__type">{propertyLabel(housing.property_type)}</span>
        <strong className="housing-detail__price">{housing.price_label}</strong>
        <h2>{housing.title}</h2>
        {housing.address && <p className="housing-detail__address"><MapPin size={15} />{housing.address}</p>}
        {housing.location_accuracy === 'approximate' && <p className="housing-detail__accuracy">Vị trí trên bản đồ là vị trí gần đúng.</p>}

        <div className="housing-detail__facts">
          {housing.area_m2 !== null && <span><Ruler size={18} /><b>{housing.area_m2} m²</b><small>Diện tích</small></span>}
          {housing.bedrooms !== null && <span><BedDouble size={18} /><b>{housing.bedrooms}</b><small>Phòng ngủ</small></span>}
          {housing.bathrooms !== null && <span><Bath size={18} /><b>{housing.bathrooms}</b><small>Phòng tắm</small></span>}
        </div>

        {housing.amenities.length > 0 && (
          <section className="housing-detail__section"><h3>Tiện nghi</h3><div className="housing-detail__amenities">{housing.amenities.slice(0, 8).map((item) => <span key={item}>{amenityLabel(item)}</span>)}</div></section>
        )}

        <section className="housing-detail__section housing-detail__nearby">
          <div><h3>Tiện ích xung quanh</h3><p>Bật lớp tiện ích để xem y tế, trường học, mua sắm và giao thông quanh căn này.</p></div>
          <button type="button" className={showPois ? 'is-active' : ''} onClick={onTogglePois}><MapPinned size={16} />{showPois ? 'Đang hiển thị' : 'Hiện trên bản đồ'}</button>
        </section>
      </div>
      <div className="housing-detail__actions">
        <button type="button" className="housing-detail__route" onClick={onRoute}><Navigation size={16} />Chỉ đường</button>
        {housing.source_url && <a href={housing.source_url} target="_blank" rel="noreferrer">Xem tin gốc<ExternalLink size={15} /></a>}
      </div>
    </aside>
  )
}
