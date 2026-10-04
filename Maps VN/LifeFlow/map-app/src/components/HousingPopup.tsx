import { Bath, BedDouble, ExternalLink, House, MapPin, Ruler } from 'lucide-react'
import type { HousingMapProperties } from '../types'

interface HousingPopupProps {
  properties: HousingMapProperties
}

const PROPERTY_LABELS: Record<string, string> = {
  apartment: 'Căn hộ',
  house: 'Nhà nguyên căn',
  room: 'Phòng trọ',
  studio: 'Studio',
  serviced_apartment: 'Căn hộ dịch vụ',
  homestay: 'Homestay',
  other: 'Nhà ở',
}

export function HousingPopup({ properties }: HousingPopupProps) {
  return (
    <article className="housing-popup">
      {properties.thumbnail_url ? (
        <img className="housing-popup__image" src={properties.thumbnail_url} alt={properties.title} loading="lazy" />
      ) : (
        <div className="housing-popup__placeholder" aria-hidden="true"><House size={32} /></div>
      )}
      <div className="housing-popup__body">
        <span className="housing-popup__type">{PROPERTY_LABELS[properties.property_type] || 'Nhà ở'}</span>
        <h3>{properties.title}</h3>
        <strong className="housing-popup__price">{properties.price_label}</strong>

        {properties.address && (
          <div className="poi-popup__row housing-popup__address">
            <MapPin size={15} aria-hidden="true" /><span>{properties.address}</span>
          </div>
        )}

        <div className="housing-popup__facts">
          {properties.area_m2 !== null && <span><Ruler size={14} aria-hidden="true" /> {properties.area_m2} m²</span>}
          {properties.bedrooms !== null && <span><BedDouble size={14} aria-hidden="true" /> {properties.bedrooms} PN</span>}
          {properties.bathrooms !== null && <span><Bath size={14} aria-hidden="true" /> {properties.bathrooms} WC</span>}
        </div>

        {properties.location_accuracy === 'approximate' && (
          <p className="housing-popup__accuracy">Vị trí hiển thị là vị trí gần đúng.</p>
        )}

        {properties.source_url && (
          <a className="housing-popup__cta" href={properties.source_url} target="_blank" rel="noreferrer">
            <span>Xem chi tiết</span><ExternalLink size={15} aria-hidden="true" />
          </a>
        )}
      </div>
    </article>
  )
}
