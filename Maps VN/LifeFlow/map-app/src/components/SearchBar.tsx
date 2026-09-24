import { useMemo, useState } from 'react'
import { Building2, Search, X } from 'lucide-react'
import { getPoiAddress, searchPois } from '../services/poi'
import type { CityConfig, PoiCollection, PoiFeature } from '../types'

interface SearchBarProps {
  city: CityConfig
  pois: PoiCollection | null
  loading: boolean
  onSelect: (poi: PoiFeature) => void
}

export function SearchBar({ city, pois, loading, onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => searchPois(pois, city, query), [city, pois, query])

  const choosePoi = (poi: PoiFeature) => {
    const name = typeof poi.properties?.name === 'string' ? poi.properties.name : 'Điểm lưu trú'
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
        placeholder={loading ? 'Đang tải địa điểm…' : `Tìm lưu trú tại ${city.label}`}
        aria-label={`Tìm địa điểm tại ${city.label}`}
        disabled={loading}
      />
      {query && (
        <button
          className="icon-button"
          type="button"
          title="Xóa tìm kiếm"
          aria-label="Xóa tìm kiếm"
          onClick={() => {
            setQuery('')
            setOpen(false)
          }}
        >
          <X size={17} />
        </button>
      )}

      {open && query.trim().length >= 2 && (
        <div className="search-results">
          {results.length ? (
            results.map((poi, index) => {
              const properties = poi.properties || {}
              const name = typeof properties.name === 'string' ? properties.name : 'Điểm lưu trú'
              const address = getPoiAddress(properties)
              const category = String(properties.tourism || properties.amenity || 'accommodation')
              return (
                <button
                  type="button"
                  className="search-result"
                  onClick={() => choosePoi(poi)}
                  key={`${poi.id ?? name}-${index}`}
                >
                  <Building2 size={17} aria-hidden="true" />
                  <span>
                    <strong>{name}</strong>
                    <small>{address || category}</small>
                  </span>
                </button>
              )
            })
          ) : (
            <p className="search-empty">Không tìm thấy địa điểm phù hợp.</p>
          )}
        </div>
      )}
    </div>
  )
}
