import { defineConfig } from "@playwright/test";

// Pure function contracts need neither a browser nor a running gateway/provider.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: [
    "scope-contracts.spec.ts",
    "housing-controls.contracts.spec.ts",
    "housing-cost.contracts.spec.ts",
    "housing-media.contracts.spec.ts",
    "moving-submission.contracts.spec.ts",
    "staging-context.contracts.spec.ts",
    "service-request.contracts.spec.ts",
    "viewing-schedule.contracts.spec.ts",
  ],
  outputDir: "../../data/frontend-contract-results",
  workers: 1,
});
