import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AdminApp } from './admin/AdminApp'
import { RootApp } from './RootApp'
import { StartScreen } from './components/StartScreen'

let renderer: ReactTestRenderer | undefined
let originalWindow: typeof globalThis.window | undefined
let originalDocument: typeof globalThis.document | undefined
let originalFetch: typeof globalThis.fetch | undefined

beforeEach(() => {
  originalWindow = globalThis.window
  originalDocument = globalThis.document
  originalFetch = globalThis.fetch
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: '' },
  })
})

afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('root participant/admin application isolation', () => {
  it.each(['/admin', '/admin/audit'])('mounts only AdminApp at %s and never participant recovery', async (pathname) => {
    const paths: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input))
      return new Response(JSON.stringify({
        ok: false,
        error: { code: 'ADMIN_UNAUTHORIZED', message: 'Unauthorized.' },
        requestId: 'request-test',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    })
    await act(async () => { renderer = create(<RootApp pathname={pathname} />) })
    expect(renderer!.root.findAllByType(AdminApp)).toHaveLength(1)
    expect(renderer!.root.findAllByType(App)).toHaveLength(0)
    expect(paths).toEqual(['/api/admin/session'])
  })

  it('mounts the participant app elsewhere without any administrator API request', async () => {
    globalThis.fetch = vi.fn()
    await act(async () => { renderer = create(<RootApp pathname="/" />) })
    expect(renderer!.root.findAllByType(App)).toHaveLength(1)
    expect(renderer!.root.findAllByType(StartScreen)).toHaveLength(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
