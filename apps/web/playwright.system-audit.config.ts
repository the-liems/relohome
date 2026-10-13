import { defineConfig } from "@playwright/test";
import base from "./playwright.roommate-ui.config";

export default defineConfig({
  ...base,
  testMatch: "*.spec.ts",
  testIgnore: "**/*.integration.spec.ts",
  outputDir: "test-results/system-audit",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "../../logs/local/system-browser-audit-20261007.json" },
    ],
  ],
});
