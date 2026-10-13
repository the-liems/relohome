import { defineConfig } from "@playwright/test";

// Public presentation tests: real frontend, no API interception or fabricated responses.
// The gateway is optional for the landing page. Authenticated workspace tests are separate.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "landing.public.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5186",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 960 },
    screenshot: "only-on-failure",
  },
  outputDir: "../../data/landing-browser-results",
  webServer: {
    command: "npm run dev -- --port 5186",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
