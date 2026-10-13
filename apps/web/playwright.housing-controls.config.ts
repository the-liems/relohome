import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "housing-controls.live.spec.ts",
  outputDir: "../../data/issue79-browser-results",
  timeout: 240000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18509",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 960 },
    screenshot: "only-on-failure",
    actionTimeout: 15000,
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command:
      "node ../../scripts/python.mjs -m uvicorn tests.browser_gateway.runtime_gateway_audit_server:app --host 127.0.0.1 --port 18509",
    url: "http://127.0.0.1:18509/health",
    reuseExistingServer: false,
    env: {
      RUNTIME_AUDIT_RUN:
        process.env.HOUSING_CONTROLS_RUN || "issue79-browser-" + Date.now(),
    },
  },
});
