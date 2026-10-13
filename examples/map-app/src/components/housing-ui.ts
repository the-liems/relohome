import type { HousingFeature, HousingMapProperties } from '../types'

export const PROPERTY_LABELS: Record<string, string> = {
  apartment: 'Căn hộ',
  house: 'Nhà nguyên căn',
  room: 'Phòng trọ',
  studio: 'Studio',
  serviced_apartment: 'Căn hộ dịch vụ',
  homestay: 'Homestay',
  other: 'Nhà ở',
}

export const AMENITY_LABELS: Record<string, string> = {
  air_conditioning: 'Điều hòa',
  allow_cooking: 'Được nấu ăn',
  balcony: 'Ban công',
  bed: 'Giường',
  elevator: 'Thang máy',
  furnished: 'Nội thất',
  gym: 'Phòng gym',
  kitchen: 'Bếp',
  natural_light: 'Ánh sáng tự nhiên',
  parking: 'Chỗ để xe',
  pet_friendly: 'Cho phép thú cưng',
  private_bathroom: 'WC riêng',
  refrigerator: 'Tủ lạnh',
  security: 'An ninh',
  swimming_pool: 'Hồ bơi',
  television: 'TV',
  washing_machine: 'Máy giặt',
  wardrobe: 'Tủ quần áo',
  water_heater: 'Máy nước nóng',
  wifi: 'Wi-Fi',
}

export function isHousingListing(feature: HousingFeature): feature is HousingFeature & { properties: HousingMapProperties } {
  return feature.properties.entity_kind === 'housing'
}

export function propertyLabel(type: string) {
  return PROPERTY_LABELS[type] || 'Nhà ở'
}

export function amenityLabel(value: string) {
  return AMENITY_LABELS[value] || value.replaceAll('_', ' ')
}

export function shortAddress(address: string) {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.slice(-2).join(', ') || address
}
