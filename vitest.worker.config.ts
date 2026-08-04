import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['worker-tests/**/*.test.ts'],
    // Each file owns an isolated Miniflare/D1 runtime and applies migrations
    // all Stage 1-10 migrations. Running several cold runtimes concurrently on Windows can make
    // workerd reserve the same transient proxy port (EADDRINUSE). Serializing
    // files keeps that infrastructure race out of the suite without weakening
    // assertions or sharing database state between tests.
    fileParallelism: false,
    // 0015 forward-migrates an append-only audit table; a cold Windows D1
    // runtime can legitimately take just over twenty seconds before a test
    // starts. This changes only infrastructure time allowance, not assertions.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
