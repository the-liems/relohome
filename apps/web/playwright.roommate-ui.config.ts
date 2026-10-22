import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: [
    "roommate.spec.ts",
    "roommate-production.spec.ts",
    "roommate-resolve.spec.ts",
    "roommate-admin.spec.ts",
    "app.spec.ts",
  ],
  outputDir: "test-results/roommate-ui",
  use: { ...base.use, baseURL: "http://127.0.0.1:18574" },
  webServer: {
    command: "npm run dev -- --port 18574",
    url: "http://127.0.0.1:18574",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
