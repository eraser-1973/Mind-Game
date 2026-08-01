import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker-tests/**/*.test.ts'],
    // Miniflare cold starts can exceed Vitest's 5s default when all D1 suites
    // run concurrently; assertion failures still fail within this bounded budget.
    testTimeout: 10_000,
  },
})
