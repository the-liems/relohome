import { defineConfig } from "@playwright/test";

// Real gateway/backend/providers. Disposable login DB; no API interception/fixtures.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "workspace-repairs.live.spec.ts",
  outputDir: "../../data/issue70-browser-results",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18505",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 960 },
    timezoneId: "Asia/Ho_Chi_Minh",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node ../../scripts/python.mjs -m uvicorn tests.browser_gateway.runtime_gateway_audit_server:app --host 127.0.0.1 --port 18505",
    url: "http://127.0.0.1:18505/health",
    reuseExistingServer: false,
    env: { RUNTIME_AUDIT_RUN: "issue70-browser-" + Date.now() },
  },
});
