import { CITY_CONFIG, CITY_ORDER } from '../config/cities'
import type { CityId } from '../types'

interface CitySwitcherProps {
  activeCity: CityId
  onChange: (city: CityId) => void
}

export function CitySwitcher({ activeCity, onChange }: CitySwitcherProps) {
  return (
    <div className="city-switcher" role="group" aria-label="Chọn thành phố">
      {CITY_ORDER.map((cityId) => {
        const city = CITY_CONFIG[cityId]
        return (
          <button className={cityId === activeCity ? 'city-button is-active' : 'city-button'}
            type="button" title={city.label} aria-label={city.label} aria-pressed={cityId === activeCity}
            onClick={() => onChange(cityId)} key={cityId}>
            {city.shortLabel}
          </button>
        )
      })}
    </div>
  )
}
