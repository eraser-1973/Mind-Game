import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker-tests/**/*.test.ts'],
    // Each file owns an isolated Miniflare/D1 runtime and applies migrations
    // all Stage 1-8 migrations. Running several cold runtimes concurrently on Windows can make
    // workerd reserve the same transient proxy port (EADDRINUSE). Serializing
    // files keeps that infrastructure race out of the suite without weakening
    // assertions or sharing database state between tests.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
