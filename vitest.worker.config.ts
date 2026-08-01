import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker-tests/**/*.test.ts'],
    // Every runtime now applies migrations 0001-0007. Concurrent Miniflare/D1
    // cold starts can approach 10s on Windows, so keep a bounded margin while
    // preserving every assertion and failing genuinely hung tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
