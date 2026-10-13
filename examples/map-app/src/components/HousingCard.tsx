import { Bath, BedDouble, Heart, House, MapPin, Ruler } from 'lucide-react'
import type { HousingFeature, HousingMapProperties } from '../types'
import { amenityLabel, propertyLabel, shortAddress } from './housing-ui'

interface HousingCardProps {
  feature: HousingFeature & { properties: HousingMapProperties }
  selected: boolean
  hovered: boolean
  saved: boolean
  onSelect: () => void
  onHover: (hovered: boolean) => void
  onToggleSave: () => void
}

export function HousingCard({ feature, selected, hovered, saved, onSelect, onHover, onToggleSave }: HousingCardProps) {
  const housing = feature.properties
  return (
    <article className={`housing-card${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
      data-listing-id={housing.listing_id} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button className="housing-card__main" type="button" onClick={onSelect} aria-label={`Xem ${housing.title}`}
        aria-pressed={selected}>
        <span className="housing-card__media">
          {housing.thumbnail_url
            ? <img src={housing.thumbnail_url} alt="" loading="lazy" />
            : <span className="housing-card__placeholder"><House size={28} aria-hidden="true" /></span>}
          {housing.location_accuracy === 'approximate' && <span className="housing-card__accuracy">Vị trí gần đúng</span>}
        </span>
        <span className="housing-card__content">
          <span className="housing-card__topline">
            <strong>{housing.price_label}</strong>
            <small>{propertyLabel(housing.property_type)}</small>
          </span>
          <span className="housing-card__title">{housing.title}</span>
          <span className="housing-card__facts">
            {housing.area_m2 !== null && <span><Ruler size={13} />{housing.area_m2} m²</span>}
            {housing.bedrooms !== null && <span><BedDouble size={13} />{housing.bedrooms} PN</span>}
            {housing.bathrooms !== null && <span><Bath size={13} />{housing.bathrooms} WC</span>}
          </span>
          {housing.address && <span className="housing-card__address"><MapPin size={13} />{shortAddress(housing.address)}</span>}
          {housing.amenities.length > 0 && (
            <span className="housing-card__tags">
              {housing.amenities.slice(0, 2).map((amenity) => <small key={amenity}>{amenityLabel(amenity)}</small>)}
            </span>
          )}
        </span>
      </button>
      <button type="button" className={saved ? 'housing-card__save is-saved' : 'housing-card__save'}
        aria-label={saved ? 'Bỏ lưu nhà ở' : 'Lưu nhà ở'} aria-pressed={saved} onClick={onToggleSave}>
        <Heart size={16} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </article>
  )
}
