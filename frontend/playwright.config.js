import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.js",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node frontend/tests/server.js",
      cwd: "..",
      url: "http://127.0.0.1:3001/api/reports/invalid",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev:frontend",
      cwd: "..",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
