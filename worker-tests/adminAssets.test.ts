import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import type { Env } from '../worker/env'

describe('/admin static application security', () => {
  it.each(['/admin', '/admin/audit'])('serves %s through SPA assets with strict administrator headers', async (path) => {
    const response = await worker.fetch(
      new Request(`https://example.test${path}`),
      {
        DB: {} as D1Database,
        ASSETS: {
          fetch: async () => new Response('<!doctype html><div id="root"></div>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
        } as unknown as Fetcher,
      } satisfies Env,
    )
    const csp = response.headers.get('content-security-policy') ?? ''

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('id="root"')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("img-src 'self' data:")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-eval')
  })
})
