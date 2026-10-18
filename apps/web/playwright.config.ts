import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: "**/*.integration.spec.ts",
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    // General feature regressions model a returning visitor. onboarding.spec.ts
    // explicitly starts with empty storage to cover the first-visit invitation.
    storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5174", localStorage: [
      { name: "relohome.onboarding.v1.seen", value: "1" },
    ] }] },
    channel: "chrome",
    // Optional user-installed Chrome for Testing; default remains system Chrome.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH },
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
