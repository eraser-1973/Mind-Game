import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ConsentScreen } from './components/ConsentScreen'
import { DemographicForm } from './components/DemographicForm'
import { IdentityForm } from './components/IdentityForm'
import { StartScreen } from './components/StartScreen'
import {
  FORMAL_SESSION_STORAGE_KEY,
  PENDING_CREATION_KEY_STORAGE_KEY,
} from './utils/formalSessionStorage'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const successData = {
  created: true,
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  mode: 'formal',
  configSetId: 'config-2026-07-v1',
  versions: {
    task: 'task-1.0.0',
    material: 'material-1.0.0',
    pointRule: 'points-5-v1',
    scoring: 'RDI-2.0-prepilot',
    benchmark: 'benchmark-1.0.0',
    norm: null,
  },
  candidateDisplayOrder: ['D', 'B', 'E', 'A', 'C'],
  initialOpenedCandidate: 'D',
  currentStep: 'demographics',
  createdAt: '2026-07-31T00:00:00.000Z',
}

let localStorage: MemoryStorage
let sessionStorage: MemoryStorage
let originalWindow: typeof globalThis.window | undefined
let originalFetch: typeof globalThis.fetch | undefined
let renderer: ReactTestRenderer | undefined

beforeEach(() => {
  localStorage = new MemoryStorage()
  sessionStorage = new MemoryStorage()
  originalWindow = globalThis.window
  originalFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      sessionStorage,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    },
  })
})

afterEach(() => {
  if (renderer) {
    act(() => renderer?.unmount())
  }
  renderer = undefined
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function startFormal() {
  renderer = create(<App />)
  act(() => renderer!.root.findByType(StartScreen).props.onStart('formal'))
  expect(renderer.root.findAllByType(ConsentScreen)).toHaveLength(1)
  act(() => renderer!.root.findByType(ConsentScreen).props.onAccept())
  return renderer.root.findByType(IdentityForm)
}

describe('App formal session creation flow', () => {
  it('routes formal consent to identity and successful creation to demographics', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, data: successData, requestId: 'request-1' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const identity = startFormal()

    await act(async () => {
      await identity.props.onSubmit({ fullName: 'In Memory Only' })
    })

    expect(renderer!.root.findAllByType(IdentityForm)).toHaveLength(0)
    expect(renderer!.root.findAllByType(DemographicForm)).toHaveLength(1)
    const stored = localStorage.getItem(FORMAL_SESSION_STORAGE_KEY) ?? ''
    expect(JSON.parse(stored)).toMatchObject({
      sessionId: successData.sessionId,
      participantId: successData.participantId,
      candidateDisplayOrder: successData.candidateDisplayOrder,
    })
    expect(stored).not.toContain('In Memory Only')
    expect(sessionStorage.getItem(PENDING_CREATION_KEY_STORAGE_KEY)).toBeNull()
  })

  it('stays on identity after failure and reuses the same pending key on retry', async () => {
    const keys: string[] = []
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async (_url: unknown, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '')
        throw new Error('offline')
      })
      .mockImplementationOnce(async (_url: unknown, init: RequestInit) => {
        keys.push(new Headers(init.headers).get('Idempotency-Key') ?? '')
        return new Response(
          JSON.stringify({ ok: true, data: successData, requestId: 'request-2' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })
    const identity = startFormal()

    await expect(identity.props.onSubmit({ studentId: 'RETRY-001' })).rejects.toThrow()
    expect(renderer!.root.findAllByType(IdentityForm)).toHaveLength(1)
    await act(async () => {
      await renderer!.root
        .findByType(IdentityForm)
        .props.onSubmit({ studentId: 'RETRY-001' })
    })

    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(keys[1]).toBe(keys[0])
    expect(renderer!.root.findAllByType(DemographicForm)).toHaveLength(1)
  })

  it('keeps quick mode out of identity, API, and formal storage', () => {
    globalThis.fetch = vi.fn()
    renderer = create(<App />)

    act(() => renderer!.root.findByType(StartScreen).props.onStart('quick'))

    expect(renderer.root.findAllByType(IdentityForm)).toHaveLength(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()
    expect(sessionStorage.getItem(PENDING_CREATION_KEY_STORAGE_KEY)).toBeNull()
  })
})
