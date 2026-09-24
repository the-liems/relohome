import { Building2, Globe2, MapPin, Phone } from 'lucide-react'
import { getPoiAddress, getProperty } from '../services/poi'
import type { PoiProperties } from '../types'

interface PoiPopupProps {
  properties: PoiProperties
}

export function PoiPopup({ properties }: PoiPopupProps) {
  const name = getProperty(properties, 'name', 'name:vi', 'name:en') || 'Điểm lưu trú'
  const category = getProperty(properties, 'tourism', 'amenity')
  const address = getPoiAddress(properties)
  const phone = getProperty(properties, 'phone', 'contact:phone', 'mobile')
  const website = getProperty(properties, 'website', 'contact:website', 'url')
  const websiteUrl = website && (/^https?:\/\//i.test(website) ? website : `https://${website}`)

  return (
    <article className="poi-popup">
      <div className="poi-popup__heading">
        <Building2 size={18} aria-hidden="true" />
        <div>
          <h3>{name}</h3>
          {category && <p>{category}</p>}
        </div>
      </div>
      {address && (
        <div className="poi-popup__row">
          <MapPin size={15} aria-hidden="true" />
          <span>{address}</span>
        </div>
      )}
      {phone && (
        <a className="poi-popup__row" href={`tel:${phone}`}>
          <Phone size={15} aria-hidden="true" />
          <span>{phone}</span>
        </a>
      )}
      {websiteUrl && (
        <a className="poi-popup__row" href={websiteUrl} target="_blank" rel="noreferrer">
          <Globe2 size={15} aria-hidden="true" />
          <span>Website</span>
        </a>
      )}
    </article>
  )
}
