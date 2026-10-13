import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "roommate.integration.spec.ts",
  outputDir: "test-results/roommate-integration",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18503",
    channel: "chrome",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH },
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "roommate-real-api",
      use: { viewport: { width: 1440, height: 960 } },
    },
  ],
  webServer: {
    command:
      "node ../../scripts/python.mjs -m uvicorn tests.browser_gateway.roommate_test_server:app --host 127.0.0.1 --port 18503",
    url: "http://127.0.0.1:18503/roommate",
    reuseExistingServer: false,
    env: {
      ROOMMATE_BROWSER_RUN: "roommate-browser-" + Date.now(),
      LANGCHAIN_TRACING_V2: "false",
      LANGSMITH_TRACING: "false",
      LANGCHAIN_TRACING: "false",
    },
  },
});
