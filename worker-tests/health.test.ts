import { describe, expect, it } from 'vitest'
import worker from '../worker/index'
import type { Env } from '../worker/env'
import { createWorkerRuntime } from './runtime'

type ErrorBody = {
  ok: false
  error: { code: string; message: string }
  requestId: string
}

describe('GET /api/health', () => {
  it('reads the migrated D1 metadata and returns a no-store JSON response', async () => {
    const { runtime } = await createWorkerRuntime()
    const response = await runtime.dispatchFetch(
      'https://example.test/api/health',
    )
    const body = (await response.json()) as {
      ok: true
      data: {
        service: string
        database: string
        schemaVersion: string
        timestamp: string
      }
      requestId: string
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(body).toMatchObject({
      ok: true,
      data: {
        service: 'mind-game-api',
        database: 'reachable',
        schemaVersion: '11',
      },
    })
    expect(Number.isNaN(Date.parse(body.data.timestamp))).toBe(false)
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i)
    await runtime.dispose()
  })

  it('rejects non-GET methods with Allow GET and a public error envelope', async () => {
    const { runtime } = await createWorkerRuntime()
    const response = await runtime.dispatchFetch('https://example.test/api/health', {
      method: 'POST',
    })
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED')
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i)
    await runtime.dispose()
  })

  it('returns a sanitized 503 when the D1 migration is not ready', async () => {
    const { runtime } = await createWorkerRuntime({ migrate: false })
    const response = await runtime.dispatchFetch(
      'https://example.test/api/health',
    )
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('select')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('stack')
    await runtime.dispose()
  })

  it('sanitizes database failures and returns 503', async () => {
    const unavailableDb = {
      prepare() {
        throw new Error(
          'database_id=secret D:\\private\\database.sqlite internal stack',
        )
      },
    } as unknown as D1Database
    const response = await worker.fetch(
      new Request('https://example.test/api/health'),
      {
        DB: unavailableDb,
        ASSETS: {} as Fetcher,
      } satisfies Env,
    )
    const body = (await response.json()) as ErrorBody
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE')
    expect(serialized).not.toContain('database_id')
    expect(serialized).not.toContain('D:\\private')
    expect(serialized.toLowerCase()).not.toContain('stack')
  })
})
