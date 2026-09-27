import { useMemo, useState } from 'react'
import { House, MapPin, Search, X } from 'lucide-react'
import { getPoiAddress, searchPois } from '../services/poi'
import type { CityConfig, PoiCollection, PoiFeature } from '../types'

interface SearchBarProps {
  city: CityConfig
  pois: PoiCollection | null
  loading: boolean
  onSelect: (poi: PoiFeature) => void
}

const HOUSING_LABELS: Record<string, string> = {
  apartment: 'Căn hộ',
  house: 'Nhà nguyên căn',
  room: 'Phòng trọ',
  studio: 'Studio',
  serviced_apartment: 'Căn hộ dịch vụ',
  homestay: 'Homestay',
  other: 'Nhà ở',
}

export function SearchBar({ city, pois, loading, onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => searchPois(pois, city, query), [city, pois, query])

  const choosePoi = (poi: PoiFeature) => {
    const name = typeof poi.properties?.name === 'string' ? poi.properties.name : 'Địa điểm'
    setQuery(name)
    setOpen(false)
    onSelect(poi)
  }

  return (
    <div className="search" role="search">
      <Search aria-hidden="true" size={18} />
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? 'Đang tải dữ liệu…' : 'Tìm khu vực, địa chỉ, trường học hoặc tiện ích gần nhà…'}
        aria-label={`Tìm nhà ở và vị trí tại ${city.label}`}
        disabled={loading}
      />
      {query && (
        <button className="icon-button" type="button" title="Xóa tìm kiếm" aria-label="Xóa tìm kiếm"
          onClick={() => { setQuery(''); setOpen(false) }}>
          <X size={17} />
        </button>
      )}

      {open && query.trim().length >= 2 && (
        <div className="search-results">
          {results.length ? (
            results.map((poi, index) => {
              const properties = poi.properties || {}
              const name = typeof properties.name === 'string' ? properties.name : 'Địa điểm'
              const address = getPoiAddress(properties)
              const isHousing = properties.entity_kind === 'housing'
              const category = isHousing
                ? HOUSING_LABELS[String(properties.property_type || 'other')] || 'Nhà ở'
                : String(properties.category || properties.tourism || properties.amenity || 'Địa điểm').replaceAll('_', ' ')
              return (
                <button type="button" className={`search-result${isHousing ? ' search-result--housing' : ''}`}
                  onClick={() => choosePoi(poi)} key={`${poi.id ?? name}-${index}`}>
                  <span className="search-result__icon">
                    {isHousing ? <House size={17} aria-hidden="true" /> : <MapPin size={17} aria-hidden="true" />}
                  </span>
                  <span className="search-result__content">
                    <strong>{name}</strong>
                    <small><b>{category}</b>{address && <span> · {address}</span>}</small>
                  </span>
                </button>
              )
            })
          ) : (
            <p className="search-empty">Không tìm thấy nhà ở hoặc địa điểm phù hợp.</p>
          )}
        </div>
      )}
    </div>
  )
}
