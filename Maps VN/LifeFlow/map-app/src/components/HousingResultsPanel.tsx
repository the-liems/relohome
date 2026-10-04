import { ChevronLeft, ChevronRight, Home, SearchX } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { HousingFeature, HousingMapProperties } from '../types'
import { HousingCard } from './HousingCard'

interface HousingResultsPanelProps {
  listings: Array<HousingFeature & { properties: HousingMapProperties }>
  totalCount: number
  loading: boolean
  clusterMode: boolean
  open: boolean
  selectedId: string | null
  hoveredId: string | null
  savedIds: Set<string>
  activeFilterCount: number
  onToggle: () => void
  onResetFilters: () => void
  onSelect: (feature: HousingFeature & { properties: HousingMapProperties }) => void
  onHover: (feature: (HousingFeature & { properties: HousingMapProperties }) | null) => void
  onToggleSave: (listingId: string) => void
}

export function HousingResultsPanel({
  listings, totalCount, loading, clusterMode, open, selectedId, hoveredId, savedIds, activeFilterCount,
  onToggle, onResetFilters, onSelect, onHover, onToggleSave,
}: HousingResultsPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedId || !open) return
    const list = listRef.current
    const card = list?.querySelector<HTMLElement>(`[data-listing-id="${CSS.escape(selectedId)}"]`)
    if (!list || !card) return
    const cardTop = card.offsetTop
    const cardBottom = cardTop + card.offsetHeight
    if (cardTop < list.scrollTop || cardBottom > list.scrollTop + list.clientHeight) {
      list.scrollTo({
        top: Math.max(0, cardTop - (list.clientHeight - card.offsetHeight) / 2),
        behavior: 'smooth',
      })
    }
  }, [open, selectedId])

  if (!open) {
    return (
      <aside className="results-panel results-panel--collapsed" aria-label="Danh sách nhà ở">
        <button type="button" className="results-panel__launcher" onClick={onToggle}>
          <Home size={18} /><span><strong>{totalCount.toLocaleString('vi-VN')}</strong><small>chỗ ở</small></span><ChevronRight size={17} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="results-panel" aria-label="Danh sách nhà ở">
      <header className="results-panel__header">
        <div><span className="eyebrow">Nhà ở quanh đây</span><h1>{totalCount.toLocaleString('vi-VN')} lựa chọn</h1></div>
        <button type="button" className="icon-button icon-button--bordered" aria-label="Thu gọn danh sách" onClick={onToggle}>
          <ChevronLeft size={17} />
        </button>
      </header>
      {loading && <span className="results-panel__loading" aria-label="Đang cập nhật danh sách" />}
      <div className="results-panel__list" ref={listRef}>
        {loading && listings.length === 0 && !clusterMode && Array.from({ length: 4 }, (_, index) => (
          <div className="housing-card-skeleton" key={index}><span /><div><i /><i /><i /></div></div>
        ))}
        {!loading && clusterMode && (
          <div className="results-panel__empty"><Home size={28} /><strong>Phóng to để xem từng chỗ ở</strong><p>Bản đồ đang gom các tin thành cụm để giữ giao diện gọn và tải nhanh.</p></div>
        )}
        {!loading && !clusterMode && listings.length === 0 && (
          <div className="results-panel__empty"><SearchX size={28} /><strong>Không tìm thấy chỗ ở phù hợp</strong><p>Hãy thử bỏ bớt bộ lọc hoặc di chuyển sang khu vực khác.</p>{activeFilterCount > 0 && <button type="button" onClick={onResetFilters}>Xóa bộ lọc</button>}</div>
        )}
        {listings.map((feature) => (
          <HousingCard key={feature.properties.listing_id} feature={feature}
            selected={selectedId === feature.properties.listing_id}
            hovered={hoveredId === feature.properties.listing_id}
            saved={savedIds.has(feature.properties.listing_id)}
            onSelect={() => onSelect(feature)} onHover={(value) => onHover(value ? feature : null)}
            onToggleSave={() => onToggleSave(feature.properties.listing_id)} />
        ))}
      </div>
      <footer className="results-panel__footer">
        <span>Dữ liệu theo vùng bản đồ hiện tại</span>
        {totalCount > listings.length && !clusterMode && <span>Hiển thị {listings.length}/{totalCount}</span>}
      </footer>
    </aside>
  )
}
