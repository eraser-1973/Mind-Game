import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('administrator asset routing configuration', () => {
  it('runs the Worker before assets for the admin shell and every admin subpath', async () => {
    const config = JSON.parse(
      await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    ) as {
      assets?: { run_worker_first?: boolean | string[] }
    }

    expect(config.assets?.run_worker_first).toEqual(expect.arrayContaining([
      '/api/*',
      '/admin',
      '/admin/*',
    ]))
  })
})
