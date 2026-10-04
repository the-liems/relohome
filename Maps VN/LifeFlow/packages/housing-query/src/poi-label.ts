const categories: Record<string, string> = {
  university: 'Trường đại học', school: 'Trường học', college: 'Trường cao đẳng',
  bus_stop: 'Trạm xe buýt', bus_station: 'Bến xe', rail_station: 'Ga tàu',
  hospital: 'Bệnh viện', clinic: 'Phòng khám', pharmacy: 'Nhà thuốc',
  supermarket: 'Siêu thị', convenience_store: 'Cửa hàng tiện lợi', marketplace: 'Chợ',
  hotel: 'Khách sạn', guest_house: 'Nhà khách', restaurant: 'Nhà hàng', cafe: 'Quán cà phê',
  swimming_pool: 'Bể bơi', gym: 'Phòng tập', park: 'Công viên', parking: 'Bãi đỗ xe',
}
export function poiDisplayName(name: string, category: string, city?: string | null, parent?: string | null) {
  return [...new Set([name, categories[category] || category, city, parent].filter(Boolean))].join(' · ')
}
