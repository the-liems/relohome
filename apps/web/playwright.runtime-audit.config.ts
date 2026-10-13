import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "runtime-audit.live.spec.ts",
  outputDir: "test-results/runtime-audit",
  timeout: 180000,
  workers: 1,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../logs/local/runtime-browser-audit-20261007.json" },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:18504",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "runtime-desktop",
      use: { viewport: { width: 1440, height: 960 } },
    },
  ],
  webServer: {
    command:
      "node ../../scripts/python.mjs -m uvicorn tests.browser_gateway.runtime_gateway_audit_server:app --host 127.0.0.1 --port 18504",
    url: "http://127.0.0.1:18504/",
    reuseExistingServer: false,
    env: {
      RUNTIME_AUDIT_RUN: "runtime-browser-" + Date.now(),
      LANGCHAIN_TRACING_V2: "false",
      LANGSMITH_TRACING: "false",
    },
  },
});
