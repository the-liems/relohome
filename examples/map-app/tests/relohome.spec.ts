import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const map = (window as unknown as { __LIFEFLOW_MAP__?: { isStyleLoaded: () => boolean } })
      .__LIFEFLOW_MAP__
    return map?.isStyleLoaded()
  })
})

test('loads real POIs and switches all cities without reload', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'TP.HCM', pressed: true })).toBeVisible()
  const poiCount = await page.evaluate(async () => {
    const response = await fetch('/data/accommodations.geojson')
    const data = await response.json()
    return data.features.length
  })
  expect(poiCount).toBe(13_120)

  await page.getByRole('button', { name: 'Hà Nội' }).click()
  await expect(page.getByRole('button', { name: 'Hà Nội', pressed: true })).toBeVisible()
  await page.getByRole('button', { name: 'Đà Nẵng' }).click()
  await expect(page.getByRole('button', { name: 'Đà Nẵng', pressed: true })).toBeVisible()
  await waitForMapToSettle(page)
  await expect.poll(async () => {
    return page.evaluate(() => {
      const map = (window as unknown as {
        __LIFEFLOW_MAP__: { getCenter: () => { lng: number; lat: number } }
      }).__LIFEFLOW_MAP__
      const center = map.getCenter()
      return Math.hypot(center.lng - 108.2208, center.lat - 16.0678)
    })
  }).toBeLessThan(0.02)
  await page.screenshot({ path: 'test-results/city-switch.png', fullPage: true })
})

test('loads every POI group by default in a single map request', async ({ page }) => {
  const apiStatuses: number[] = []
  const fallbackWarnings: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/v1/places/map')) apiStatuses.push(response.status())
  })
  page.on('console', (message) => {
    if (message.text().includes('local POI fallback')) fallbackWarnings.push(message.text())
  })

  await page.reload()
  await expect(page.locator('.search input')).toBeEnabled()
  expect(apiStatuses.length).toBeGreaterThan(0)
  expect(apiStatuses.every((status) => status === 200)).toBe(true)
  expect(fallbackWarnings).toEqual([])
  const data = await mapPois(page)
  expect(data.features.length).toBeGreaterThan(30_000)
  expect(new Set(data.features.map((feature) => feature.properties.group)).size).toBe(8)
  await expect(page.locator('.poi-groups')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/all-pois-desktop.png', fullPage: true })
})

test('keeps amenities automatic and searches housing and places together', async ({ page }) => {
  await expect(page.locator('.search input')).toBeEnabled()
  const all = await mapPois(page)
  const namedHotel = all.features.find((feature) => feature.properties.group === 'accommodation' && feature.properties.name && feature.properties.name.length > 5)!
  let requests = 0
  page.on('request', (request) => { if (request.url().includes('/v1/places/')) requests += 1 })
  await expect(page.locator('.poi-groups')).toHaveCount(0)
  expect(new Set(all.features.map((feature) => feature.properties.group)).size).toBe(8)
  await page.locator('.search input').fill(namedHotel.properties.name!)
  await page.locator('.search-result').first().click()
  await expect.poll(async () => (await mapPois(page)).features.length).toBe(all.features.length)
  expect(requests).toBe(0)
})

test('renders housing listings as the primary price-marker layer', async ({ page }) => {
  await page.route('**/v1/housing/map', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      features: [{
        kind: 'listing',
        listing_id: '11111111-1111-4111-8111-111111111111',
        title: 'Phòng trọ gần Đại học Quốc gia',
        property_type: 'room',
        listing_type: 'rent',
        location: { lng: 106.7009, lat: 10.7769 },
        address: { street: 'Đường Lê Duẩn', city: 'TP.HCM' },
        price: { amount: 3_500_000, currency: 'VND', period: 'month' },
        bedrooms: 1,
        bathrooms: 1,
        area_m2: 25,
        amenities: ['wifi', 'air_conditioning'],
        source_url: 'https://example.com/listing/1',
        thumbnail_url: null,
        location_accuracy: 'rooftop',
      }],
      meta: { mode: 'listings', returned_count: 1, truncated: false },
    }),
  }))
  await page.reload()
  await page.waitForFunction(() => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__?: { isStyleLoaded: () => boolean; getSource: (id: string) => unknown }
    }).__LIFEFLOW_MAP__
    return map?.isStyleLoaded() && Boolean(map.getSource('lifeflow-housing'))
  })
  await expect.poll(async () => page.evaluate(async () => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: {
        getSource: (id: string) => { getData: () => Promise<{ features: Array<{ properties: { entity_kind: string; price_amount: number } }> }> }
      }
    }).__LIFEFLOW_MAP__
    const data = await map.getSource('lifeflow-housing').getData()
    return data.features.map((feature) => feature.properties)
  })).toEqual([{
    entity_kind: 'housing',
    listing_id: '11111111-1111-4111-8111-111111111111',
    name: 'Phòng trọ gần Đại học Quốc gia',
    title: 'Phòng trọ gần Đại học Quốc gia',
    property_type: 'room',
    listing_type: 'rent',
    category: 'room',
    group: 'accommodation',
    address: 'Đường Lê Duẩn, TP.HCM',
    price_amount: 3_500_000,
    price_currency: 'VND',
    price_period: 'month',
    price_label: '3,5 tr/tháng',
    bedrooms: 1,
    bathrooms: 1,
    area_m2: 25,
    amenities: ['wifi', 'air_conditioning'],
    source_url: 'https://example.com/listing/1',
    thumbnail_url: null,
    location_accuracy: 'rooftop',
  }])
})

test('keeps housing list, selected marker, detail, and filters synchronized', async ({ page }) => {
  await expect(page.locator('.housing-card').first()).toBeVisible()
  const firstCard = page.locator('.housing-card').first()
  await firstCard.locator('.housing-card__main').click()
  await expect(firstCard).toHaveClass(/is-selected/)
  await expect(page.locator('.housing-detail')).toBeVisible()
  await expect.poll(async () => page.evaluate(async () => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: {
        getSource: (id: string) => { getData: () => Promise<{ features: Array<{ properties: { interaction_state: string } }> }> }
      }
    }).__LIFEFLOW_MAP__
    const data = await map.getSource('lifeflow-housing-interaction').getData()
    return data.features.map((feature) => feature.properties.interaction_state)
  })).toContain('selected')

  await page.getByLabel('Đóng chi tiết').click()
  await page.getByLabel('Lọc theo giá tối đa').selectOption('5000000')
  await expect.poll(async () => page.evaluate(async () => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: {
        getSource: (id: string) => { getData: () => Promise<{ features: Array<{ properties: { price_amount: number } }> }> }
      }
    }).__LIFEFLOW_MAP__
    const data = await map.getSource('lifeflow-housing').getData()
    return data.features.every((feature) => feature.properties.price_amount <= 5_000_000)
  })).toBe(true)
  await expect(page.locator('.housing-card').first()).toBeVisible()
})

test('reports API failure instead of silently replacing all POIs with accommodation data', async ({ page }) => {
  let fallbackRequests = 0
  page.on('request', (request) => { if (request.url().includes('/data/accommodations.geojson')) fallbackRequests += 1 })
  await page.route('**/v1/places/map', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('503')
  expect(fallbackRequests).toBe(0)
})

test('opens a real POI popup', async ({ page }) => {
  await page.getByRole('button', { name: 'Hà Nội' }).click()
  const search = page.locator('.search input')
  await search.fill('Khách Sạn Đức Thái')
  await page.getByRole('button', { name: /Khách Sạn Đức Thái/ }).click()
  await expect(page.locator('.maplibregl-popup')).toBeVisible()
  await expect(page.locator('.poi-popup')).toContainText('Khách Sạn Đức Thái')
  await waitForMapToSettle(page)
  await page.screenshot({ path: 'test-results/poi-popup.png', fullPage: true })
})

test('uses clustered symbol POIs and a dedicated selected highlight', async ({ page }) => {
  const style = await page.evaluate(() => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: {
        getStyle: () => {
          sources: Record<string, { cluster?: boolean; clusterMaxZoom?: number }>
          layers: Array<{ id: string; type: string }>
        }
      }
    }).__LIFEFLOW_MAP__
    return map.getStyle()
  })
  expect(style.sources['lifeflow-pois'].cluster).toBe(true)
  expect(style.sources['lifeflow-pois'].clusterMaxZoom).toBe(13)
  expect(style.layers.find((layer) => layer.id === 'poi-points')?.type).toBe('symbol')
  expect(style.layers.find((layer) => layer.id === 'housing-price-markers')?.type).toBe('symbol')
  expect(style.layers.find((layer) => layer.id === 'selected-poi')?.type).toBe('symbol')

  await page.getByRole('button', { name: 'Hà Nội' }).click()
  const search = page.locator('.search input')
  await search.fill('Khách Sạn Đức Thái')
  await page.getByRole('button', { name: /Khách Sạn Đức Thái/ }).click()
  await expect.poll(async () => page.evaluate(async () => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: {
        getSource: (id: string) => { getData: () => Promise<{ features: unknown[] }> }
      }
    }).__LIFEFLOW_MAP__
    return (await map.getSource('lifeflow-selected-poi').getData()).features.length
  })).toBe(1)
})

test('routes A to B through the live HCM OSRM service', async ({ page }) => {
  await page.getByRole('button', { name: 'Chỉ đường' }).click()
  await clickMapCoordinate(page, [106.7009, 10.7769])
  await expect(page.getByText('Chọn tiếp điểm B.')).toBeVisible()
  await clickMapCoordinate(page, [106.7218, 10.7952])

  await expect(page.getByText('Đã tìm thấy tuyến đường phù hợp.')).toBeVisible()
  await expect(page.getByText(/\d+\.\d km/)).toBeVisible()
  await expect(page.getByText(/\d+ phút/)).toBeVisible()
  await expect.poll(async () =>
    page.evaluate(() => {
      const map = (window as unknown as {
        __LIFEFLOW_MAP__?: { queryRenderedFeatures: (options: unknown) => unknown[] }
      }).__LIFEFLOW_MAP__
      return map?.queryRenderedFeatures({ layers: ['route-line'] }).length || 0
    }),
  ).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/hcm-route.png', fullPage: true })
})

test('switches between motorcycle and walking routing graphs', async ({ page }) => {
  const requestedPorts: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.includes('/route/v1/')) requestedPorts.push(url.port)
  })

  await page.getByRole('button', { name: 'Chỉ đường' }).click()
  await clickMapCoordinate(page, [106.7009, 10.7769])
  await clickMapCoordinate(page, [106.7218, 10.7952])
  await expect(page.getByText('Đã tìm thấy tuyến đường phù hợp.')).toBeVisible()

  await page.getByRole('button', { name: 'Xe máy' }).click()
  await expect.poll(() => requestedPorts.includes('5020')).toBe(true)
  await expect(page.getByText('Đã tìm thấy tuyến đường phù hợp.')).toBeVisible()

  await page.getByRole('button', { name: 'Đi bộ' }).click()
  await expect.poll(() => requestedPorts.includes('5010')).toBe(true)
  await expect(page.getByText('Đã tìm thấy tuyến đường phù hợp.')).toBeVisible()
})

test('keeps the map usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForFunction(() => {
    const map = (window as unknown as { __LIFEFLOW_MAP__?: { isStyleLoaded: () => boolean } })
      .__LIFEFLOW_MAP__
    return map?.isStyleLoaded()
  })
  await expect(page.locator('.search input')).toBeEnabled()
  await expect(page.locator('.map-canvas')).toBeVisible()
  await expect(page.locator('.route-panel')).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
})

async function clickMapCoordinate(page: Page, coordinate: [number, number]) {
  const point = await page.evaluate(([lng, lat]) => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: {
        project: (value: [number, number]) => { x: number; y: number }
        setLayoutProperty: (layer: string, property: string, value: string) => void
      }
    }).__LIFEFLOW_MAP__
    for (const layer of ['poi-points', 'poi-clusters', 'poi-cluster-count']) map.setLayoutProperty(layer, 'visibility', 'none')
    return map.project([lng, lat])
  }, coordinate)
  const canvas = page.locator('.maplibregl-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Map canvas is not visible.')
  await page.mouse.click(box.x + point.x, box.y + point.y)
}

async function mapPois(page: Page) {
  return page.evaluate(async () => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__: { getSource: (id: string) => { getData: () => Promise<{ features: Array<{ properties: { group: string; name?: string } }> }> } }
    }).__LIFEFLOW_MAP__
    return map.getSource('lifeflow-pois').getData()
  })
}

async function waitForMapToSettle(page: Page) {
  await page.waitForTimeout(100)
  await page.waitForFunction(() => {
    const map = (window as unknown as {
      __LIFEFLOW_MAP__?: { isMoving: () => boolean; areTilesLoaded: () => boolean }
    }).__LIFEFLOW_MAP__
    return map && !map.isMoving() && map.areTilesLoaded()
  })
}
