import { BedDouble, Building2, Image, MapPinned, Ruler, SlidersHorizontal, WalletCards, X } from 'lucide-react'

export interface HousingFilters {
  maxPrice: number | null
  propertyType: string | null
  minBedrooms: number | null
  minArea: number | null
  withImage: boolean
}

interface HousingFilterBarProps {
  filters: HousingFilters
  disabled: boolean
  showPois: boolean
  onChange: (filters: HousingFilters) => void
  onTogglePois: () => void
  onReset: () => void
}

export function HousingFilterBar({ filters, disabled, showPois, onChange, onTogglePois, onReset }: HousingFilterBarProps) {
  const activeCount = [filters.maxPrice, filters.propertyType, filters.minBedrooms, filters.minArea, filters.withImage]
    .filter(Boolean).length

  return (
    <div className="housing-filters" aria-label="Bộ lọc nhà ở">
      <span className="housing-filters__lead"><SlidersHorizontal size={15} /><b>Bộ lọc</b></span>
      <label className={filters.maxPrice ? 'filter-chip is-active' : 'filter-chip'}>
        <WalletCards size={15} aria-hidden="true" />
        <select aria-label="Lọc theo giá tối đa" value={filters.maxPrice ?? ''} disabled={disabled}
          onChange={(event) => onChange({ ...filters, maxPrice: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Mọi mức giá</option>
          <option value="5000000">Đến 5 triệu</option>
          <option value="10000000">Đến 10 triệu</option>
          <option value="15000000">Đến 15 triệu</option>
          <option value="20000000">Đến 20 triệu</option>
        </select>
      </label>
      <label className={filters.propertyType ? 'filter-chip is-active' : 'filter-chip'}>
        <Building2 size={15} aria-hidden="true" />
        <select aria-label="Lọc theo loại nhà" value={filters.propertyType ?? ''} disabled={disabled}
          onChange={(event) => onChange({ ...filters, propertyType: event.target.value || null })}>
          <option value="">Loại nhà</option>
          <option value="room">Phòng trọ</option>
          <option value="apartment">Căn hộ</option>
          <option value="house">Nhà nguyên căn</option>
          <option value="studio">Studio</option>
          <option value="serviced_apartment">Căn hộ dịch vụ</option>
        </select>
      </label>
      <label className={filters.minBedrooms ? 'filter-chip is-active' : 'filter-chip'}>
        <BedDouble size={15} aria-hidden="true" />
        <select aria-label="Lọc theo số phòng ngủ" value={filters.minBedrooms ?? ''} disabled={disabled}
          onChange={(event) => onChange({ ...filters, minBedrooms: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Phòng ngủ</option>
          <option value="1">1+ PN</option>
          <option value="2">2+ PN</option>
          <option value="3">3+ PN</option>
        </select>
      </label>
      <label className={filters.minArea ? 'filter-chip is-active' : 'filter-chip'}>
        <Ruler size={15} aria-hidden="true" />
        <select aria-label="Lọc theo diện tích" value={filters.minArea ?? ''} disabled={disabled}
          onChange={(event) => onChange({ ...filters, minArea: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Diện tích</option>
          <option value="25">Từ 25 m²</option>
          <option value="40">Từ 40 m²</option>
          <option value="60">Từ 60 m²</option>
        </select>
      </label>
      <button type="button" className={filters.withImage ? 'filter-chip is-active' : 'filter-chip'} disabled={disabled}
        aria-pressed={filters.withImage} onClick={() => onChange({ ...filters, withImage: !filters.withImage })}>
        <Image size={15} aria-hidden="true" /><span>Có ảnh</span>
      </button>
      <button type="button" className={showPois ? 'filter-chip filter-chip--context is-active' : 'filter-chip filter-chip--context'}
        aria-pressed={showPois} onClick={onTogglePois}>
        <MapPinned size={15} aria-hidden="true" /><span>Tiện ích</span>
      </button>
      {activeCount > 0 && (
        <button type="button" className="filter-reset" onClick={onReset}>
          <X size={14} aria-hidden="true" /><span>Xóa {activeCount} lọc</span>
        </button>
      )}
    </div>
  )
}
