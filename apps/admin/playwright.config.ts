import { defineConfig } from '@playwright/test'

// Run through scripts/admin-e2e.sh, which starts herbot-core and the panel
// against a throwaway database and sets E2E_BASE_URL and E2E_PASSWORD.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, // tests share one seeded database
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3399',
    // Your installed Google Chrome: nothing to download.
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
})
