import { defineConfig } from "@playwright/test";

// Pure function contracts need neither a browser nor a running gateway/provider.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: [
    "scope-contracts.spec.ts",
    "housing-controls.contracts.spec.ts",
    "staging-context.contracts.spec.ts",
  ],
  outputDir: "../data/frontend-contract-results",
  workers: 1,
});
