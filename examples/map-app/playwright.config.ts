import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.LIFEFLOW_MAP_TEST_URL || 'http://127.0.0.1:5173',
    channel: 'chrome',
    // Optional user-installed Chrome for Testing; default remains system Chrome.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH },
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${new URL(process.env.LIFEFLOW_MAP_TEST_URL || 'http://127.0.0.1:5173').port}`,
    url: process.env.LIFEFLOW_MAP_TEST_URL || 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
