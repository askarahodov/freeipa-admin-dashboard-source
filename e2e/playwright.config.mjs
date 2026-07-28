import { defineConfig, devices } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI === "true" ? 1 : 0,
  reporter: [
    ["line"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
