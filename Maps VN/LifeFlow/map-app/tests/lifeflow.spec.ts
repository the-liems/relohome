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

test('loads city POIs from the Platform API without using the fallback', async ({ page }) => {
  const apiStatuses: number[] = []
  const fallbackWarnings: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/v1/places/search')) apiStatuses.push(response.status())
  })
  page.on('console', (message) => {
    if (message.text().includes('local POI fallback')) fallbackWarnings.push(message.text())
  })

  await page.reload()
  await expect.poll(() => apiStatuses.length).toBeGreaterThan(10)
  expect(apiStatuses.every((status) => status === 200)).toBe(true)
  expect(fallbackWarnings).toEqual([])
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
      __LIFEFLOW_MAP__: { project: (value: [number, number]) => { x: number; y: number } }
    }).__LIFEFLOW_MAP__
    return map.project([lng, lat])
  }, coordinate)
  const canvas = page.locator('.maplibregl-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Map canvas is not visible.')
  await page.mouse.click(box.x + point.x, box.y + point.y)
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
