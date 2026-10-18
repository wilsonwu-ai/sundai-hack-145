import { defineConfig } from 'vitest/config'

// GitHub Pages serves this repo under /sundai-hack-145/.
export default defineConfig({
  base: '/sundai-hack-145/',
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
