import { defineConfig, devices } from '@playwright/test'

// With BASE_URL set (CI smoke-prod job), the suite runs against the live site.
// Without it, it runs against `vite preview` of the local build.
const BASE_URL = process.env.BASE_URL
const LOCAL_URL = 'http://localhost:4173/sundai-hack-145/'

export default defineConfig({
  testDir: 'tests/e2e',
  retries: BASE_URL ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: BASE_URL ?? LOCAL_URL },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: BASE_URL
    ? undefined
    : { command: 'npm run preview', url: LOCAL_URL, reuseExistingServer: !process.env.CI },
})
