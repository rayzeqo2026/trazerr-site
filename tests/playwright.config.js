import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4173", browserName: "chromium", trace: "retain-on-failure" },
  webServer: { command: "node serve.mjs", url: "http://localhost:4173/", reuseExistingServer: !process.env.CI }
});
