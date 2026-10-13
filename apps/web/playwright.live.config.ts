import { defineConfig } from "@playwright/test";

// A real, isolated gateway/backend must already be running; no routed fixtures.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "moving-form.live.spec.ts",
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: process.env.MOVING_BROWSER_BASE_URL,
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 960 },
    timezoneId: "Asia/Ho_Chi_Minh",
    screenshot: "only-on-failure",
  },
  outputDir: "../../data/moving-browser-results",
});
