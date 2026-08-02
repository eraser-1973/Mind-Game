import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAdminAuditLogs,
  getAdminSession,
  loginAdmin,
  logoutAdmin,
} from './adminApi'
import { readAdminCsrfToken } from './adminCsrf'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  dump() { return JSON.stringify([...this.values.entries()]) }
}

let localStorage: MemoryStorage
let sessionStorage: MemoryStorage
let originalDocument: typeof globalThis.document | undefined
let originalWindow: typeof globalThis.window | undefined
let originalFetch: typeof globalThis.fetch | undefined

function response(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(
    status < 400
      ? { ok: true, data, requestId: 'request-test' }
      : { ok: false, error: data, requestId: 'request-test' },
  ), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

beforeEach(() => {
  localStorage = new MemoryStorage()
  sessionStorage = new MemoryStorage()
  originalDocument = globalThis.document
  originalWindow = globalThis.window
  originalFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'mg_admin_csrf=csrf-safe-value; ordinary=value' },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, sessionStorage },
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('administrator browser API boundary', () => {
  it('reads only the CSRF cookie and never reads an HttpOnly administrator token', () => {
    expect(readAdminCsrfToken()).toBe('csrf-safe-value')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { cookie: 'mg_admin=not-readable-by-real-browser; other=value' },
    })
    expect(readAdminCsrfToken()).toBeNull()
  })

  it('uses credentialed same-origin requests without browser storage', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/admin/login') return response({
        authenticated: true,
        admin: { username: 'Stage.Admin' },
        session: {
          createdAt: '2026-08-02T00:00:00.000Z',
          absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
          idleTimeoutSec: 1800,
        },
        authPolicyVersion: 'admin-auth-1.0.0',
      })
      if (path === '/api/admin/session') return response({ authenticated: true })
      return response({ items: [], nextCursor: null })
    })

    await loginAdmin('Stage.Admin', 'Synthetic local password 123!')
    await getAdminSession()
    await getAdminAuditLogs({ limit: 50 })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/admin/login', expect.objectContaining({
      method: 'POST', credentials: 'include',
    }))
    expect(localStorage.dump()).toBe('[]')
    expect(sessionStorage.dump()).toBe('[]')
  })

  it('adds the CSRF header to logout and retries it at most once after refreshing session', async () => {
    let logoutAttempts = 0
    const calls: Array<{ path: string; csrf: string | null }> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      calls.push({ path, csrf: new Headers(init?.headers).get('X-CSRF-Token') })
      if (path === '/api/admin/logout') {
        logoutAttempts += 1
        if (logoutAttempts === 1) {
          return response({ code: 'ADMIN_CSRF_REJECTED', message: 'Rejected.' }, 403)
        }
        return response({ authenticated: false, loggedOut: true })
      }
      return response({ authenticated: true })
    })

    await logoutAdmin()
    expect(calls).toEqual([
      { path: '/api/admin/logout', csrf: 'csrf-safe-value' },
      { path: '/api/admin/session', csrf: null },
      { path: '/api/admin/logout', csrf: 'csrf-safe-value' },
    ])
  })
})
