import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "integration",
  testMatch: "**/*.browser.ts",
  timeout: 60_000,
  workers: 1,
  outputDir: "../../data/web-browser-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
