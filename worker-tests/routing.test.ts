import { describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import type { Env } from '../worker/env'
import { createWorkerRuntime } from './runtime'

describe('Worker routing', () => {
  it('returns a sanitized JSON 404 for an unknown API path', async () => {
    const { runtime } = await createWorkerRuntime()
    const response = await runtime.dispatchFetch(
      'https://example.test/api/not-found',
    )
    const body = (await response.json()) as {
      ok: false
      error: { code: string; message: string }
      requestId: string
    }
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(serialized.toLowerCase()).not.toContain('<!doctype html>')
    expect(serialized.toLowerCase()).not.toContain('stack')
    expect(serialized).not.toContain('database_id')
    expect(serialized).not.toMatch(/[A-Z]:\\/)
    await runtime.dispose()
  })

  it('delegates non-API requests to the ASSETS binding', async () => {
    const assetsFetch = vi.fn(async () =>
      new Response('<!doctype html><main id="root"></main>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )
    const request = new Request(
      'https://example.test/frontend-route-that-does-not-exist',
    )
    const response = await worker.fetch(
      request,
      {
        DB: {} as D1Database,
        ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
      } satisfies Env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('<main id="root">')
    expect(assetsFetch).toHaveBeenCalledTimes(1)
    expect(assetsFetch).toHaveBeenCalledWith(request)
  })
})
