import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  use: {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite --port 1420 --strictPort',
    url: 'http://localhost:1420',
    timeout: 30000,
    reuseExistingServer: true,
  },
})
