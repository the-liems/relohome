import { BedDouble, ExternalLink, House, MapPin, Ruler } from 'lucide-react'
import type { HousingMapProperties } from '../types'

interface HousingPopupProps {
  properties: HousingMapProperties
}

const PROPERTY_LABELS: Record<string, string> = {
  apartment: 'Căn hộ',
  house: 'Nhà',
  room: 'Phòng trọ',
  studio: 'Studio',
  serviced_apartment: 'Căn hộ dịch vụ',
  homestay: 'Homestay',
  other: 'Nhà ở',
}

export function HousingPopup({ properties }: HousingPopupProps) {
  return (
    <article className="poi-popup housing-popup">
      <div className="poi-popup__heading">
        <House size={18} aria-hidden="true" />
        <div>
          <h3>{properties.title}</h3>
          <p>{PROPERTY_LABELS[properties.property_type] || 'Nhà ở'}</p>
        </div>
      </div>

      <strong className="housing-popup__price">{properties.price_label}</strong>

      {properties.address && (
        <div className="poi-popup__row">
          <MapPin size={15} aria-hidden="true" />
          <span>{properties.address}</span>
        </div>
      )}

      <div className="housing-popup__facts">
        {properties.bedrooms !== null && (
          <span><BedDouble size={14} aria-hidden="true" /> {properties.bedrooms} phòng ngủ</span>
        )}
        {properties.area_m2 !== null && (
          <span><Ruler size={14} aria-hidden="true" /> {properties.area_m2} m²</span>
        )}
      </div>

      {properties.source_url && (
        <a className="poi-popup__row" href={properties.source_url} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden="true" />
          <span>Xem tin gốc</span>
        </a>
      )}
    </article>
  )
}
