export const POI_GROUPS = {
  accommodation: { label: 'Lưu trú', categories: ['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'camp_site', 'chalet', 'resort', 'homestay'] },
  healthcare: { label: 'Y tế', categories: ['hospital', 'clinic', 'pharmacy', 'doctor', 'dentist', 'other_healthcare'] },
  shopping: { label: 'Mua sắm', categories: ['supermarket', 'convenience_store', 'shopping_mall', 'marketplace', 'shop_other'] },
  education: { label: 'Giáo dục', categories: ['school', 'kindergarten', 'college', 'university'] },
  food: { label: 'Ăn uống', categories: ['restaurant', 'cafe', 'fast_food', 'food_court'] },
  transport: { label: 'Giao thông', categories: ['bus_stop', 'bus_station', 'rail_station', 'airport', 'airport_terminal', 'public_transport_other'] },
  utility: { label: 'Tiện ích', categories: ['bank', 'atm', 'fuel', 'parking', 'ev_charging'] },
  lifestyle: { label: 'Giải trí', categories: ['gym', 'sports_centre', 'park', 'swimming_pool'] },
} as const

export type PoiGroup = keyof typeof POI_GROUPS
