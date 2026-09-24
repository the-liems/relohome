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
  await expect(page.getByRole('heading', { name: 'TP.HCM' })).toBeVisible()
  const poiCount = await page.evaluate(async () => {
    const response = await fetch('/data/accommodations.geojson')
    const data = await response.json()
    return data.features.length
  })
  expect(poiCount).toBe(13_120)

  await page.getByRole('button', { name: 'Hà Nội' }).click()
  await expect(page.getByRole('heading', { name: 'Hà Nội' })).toBeVisible()
  await page.getByRole('button', { name: 'Đà Nẵng' }).click()
  await expect(page.getByRole('heading', { name: 'Đà Nẵng' })).toBeVisible()
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
  await expect(page.getByRole('textbox', { name: /Tìm địa điểm/ })).toBeEnabled()
  expect(apiStatuses.length).toBeGreaterThan(0)
  expect(apiStatuses.every((status) => status === 200)).toBe(true)
  expect(fallbackWarnings).toEqual([])
  const data = await mapPois(page)
  expect(data.features.length).toBeGreaterThan(30_000)
  expect(new Set(data.features.map((feature) => feature.properties.group)).size).toBe(8)
  await expect(page.getByRole('button', { name: 'Tất cả', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: 'test-results/all-pois-desktop.png', fullPage: true })
})

test('filters the shared layer locally and searches across groups', async ({ page }) => {
  await expect(page.getByRole('textbox', { name: /Tìm địa điểm/ })).toBeEnabled()
  const all = await mapPois(page)
  const namedHotel = all.features.find((feature) => feature.properties.group === 'accommodation' && feature.properties.name && feature.properties.name.length > 5)!
  let requests = 0
  page.on('request', (request) => { if (request.url().includes('/v1/places/')) requests += 1 })
  await page.getByRole('button', { name: 'Y tế' }).click()
  await expect(page.getByRole('button', { name: 'Y tế' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => [...new Set((await mapPois(page)).features.map((feature) => feature.properties.group))]).toEqual(['healthcare'])
  await page.getByRole('textbox', { name: /Tìm địa điểm/ }).fill(namedHotel.properties.name!)
  await page.locator('.search-result').first().click()
  await expect(page.getByRole('button', { name: 'Tất cả', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await mapPois(page)).features.length).toBe(all.features.length)
  expect(requests).toBe(0)
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
  const search = page.getByRole('textbox', { name: /Tìm địa điểm/ })
  await search.fill('Khách Sạn Đức Thái')
  await page.getByRole('button', { name: /Khách Sạn Đức Thái/ }).click()
  await expect(page.locator('.maplibregl-popup')).toBeVisible()
  await expect(page.locator('.poi-popup')).toContainText('Khách Sạn Đức Thái')
  await waitForMapToSettle(page)
  await page.screenshot({ path: 'test-results/poi-popup.png', fullPage: true })
})

test('routes A to B through the live HCM OSRM service', async ({ page }) => {
  await clickMapCoordinate(page, [106.7009, 10.7769])
  await expect(page.getByText('Chọn tiếp điểm B.')).toBeVisible()
  await clickMapCoordinate(page, [106.7218, 10.7952])

  await expect(page.getByText('OSRM đã tìm thấy tuyến phù hợp.')).toBeVisible()
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

  await clickMapCoordinate(page, [106.7009, 10.7769])
  await clickMapCoordinate(page, [106.7218, 10.7952])
  await expect(page.getByText('OSRM đã tìm thấy tuyến phù hợp.')).toBeVisible()

  await page.getByRole('button', { name: 'Xe máy' }).click()
  await expect.poll(() => requestedPorts.includes('5020')).toBe(true)
  await expect(page.getByText('OSRM đã tìm thấy tuyến phù hợp.')).toBeVisible()

  await page.getByRole('button', { name: 'Đi bộ' }).click()
  await expect.poll(() => requestedPorts.includes('5010')).toBe(true)
  await expect(page.getByText('OSRM đã tìm thấy tuyến phù hợp.')).toBeVisible()
})

test('keeps the map usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForFunction(() => {
    const map = (window as unknown as { __LIFEFLOW_MAP__?: { isStyleLoaded: () => boolean } })
      .__LIFEFLOW_MAP__
    return map?.isStyleLoaded()
  })
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
