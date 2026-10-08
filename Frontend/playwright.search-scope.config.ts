import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: [
    "search-scope-roommate.live.spec.ts",
    "scope-contracts.spec.ts",
    "housing-comparison.live.spec.ts",
  ],
  outputDir: "../data/issue73-browser-results",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18506",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 960 },
    timezoneId: "Asia/Ho_Chi_Minh",
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
      '"..\\.venv\\Scripts\\python.exe" -m uvicorn Frontend.tests.runtime_gateway_audit_server:app --app-dir .. --host 127.0.0.1 --port 18506',
    url: "http://127.0.0.1:18506/health",
    reuseExistingServer: false,
    env: {
      RUNTIME_AUDIT_RUN:
        process.env.ROOM_SCOPE_RESUME_RUN || "issue73-browser-" + Date.now(),
    },
  },
});
