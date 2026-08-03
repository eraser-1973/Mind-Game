import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ConsentScreen } from './components/ConsentScreen'
import { DemographicForm } from './components/DemographicForm'
import { GameScreen } from './components/GameScreen'
import { IdentityForm } from './components/IdentityForm'
import { StartScreen } from './components/StartScreen'
import { StateAssessmentScreen } from './components/StateAssessmentScreen'
import type { DemographicData, FormalSessionContext, StateAssessmentData } from './types/game'
import { candidates } from './data/candidates'
import {
  FORMAL_SESSION_STORAGE_KEY,
  PENDING_CONSENT_KEY_STORAGE_KEY,
  PENDING_CREATION_KEY_STORAGE_KEY,
  PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY,
  PENDING_PRE_TASK_KEY_STORAGE_KEY,
} from './utils/formalSessionStorage'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const demographics: DemographicData = {
  ageRange: '21–23',
  gender: '不愿透露',
  education: '本科',
  grade: '大三',
  majorCategory: '计算机或人工智能',
  relatedExperience: ['数据分析相关经历'],
}
const preTask: StateAssessmentData = {
  stress: 0,
  fatigue: 1,
  attention: 2,
  mood: 3,
  physicalDiscomfort: 4,
}
const gameSnapshot = {
  started: true as const,
  resumeSupported: true as const,
  durationSec: 900 as const,
  startedAt: '2026-08-01T00:04:00.000Z',
  deadlineAt: '2026-08-01T00:19:00.000Z',
  serverNow: '2026-08-01T00:04:00.000Z',
  remainingSec: 900,
  expired: false,
  currentStage: 'T1' as const,
  stageStatus: 'T1_ACTIVE' as const,
  points: { total: 5 as const, remaining: 5 as const },
  ratings: [],
  stageChoice: null,
  stageChoices: [],
  evidenceUnlocks: [],
  lastSequenceNo: 1,
}
const context: FormalSessionContext = {
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  configSetId: 'config-2026-07-v1',
  versions: {
    task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1', sunkCostRule: 'sunk-1.0.0',
    scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null,
  },
  candidateDisplayOrder: ['D', 'B', 'E', 'A', 'C'],
  initialOpenedCandidate: 'D',
  currentStep: 'consent_pending',
  createdAt: '2026-08-01T00:00:00.000Z',
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
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'request-test' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function renderApp() {
  await act(async () => { renderer = create(<App />) })
  return renderer!
}

async function startFormal() {
  await renderApp()
  act(() => renderer!.root.findByType(StartScreen).props.onStart('formal'))
  act(() => renderer!.root.findByType(ConsentScreen).props.onAccept())
  return renderer!.root.findByType(IdentityForm)
}

function resumeData(step: FormalSessionContext['currentStep']) {
  return {
    session: { ...context, currentStep: step, mode: 'formal' },
    consent: step === 'consent_pending' ? null : {
      accepted: true, version: 'consent-1.0.0', acceptedAt: '2026-08-01T00:00:00.000Z',
    },
    demographics: ['pre_task', 'game_ready'].includes(step) ? {
      revisionNo: 1, demographics, submittedAt: '2026-08-01T00:01:00.000Z',
    } : null,
    preTask: step === 'game_ready' ? {
      instrumentVersion: 'state-assessment-pre-1.0.0',
      startedAt: '2026-08-01T00:02:00.000Z',
      submittedAt: '2026-08-01T00:03:00.000Z',
      answers: Object.entries(preTask).map(([itemId, value]) => ({
        itemId, value, touched: true, answeredAt: '2026-08-01T00:03:00.000Z',
      })),
    } : null,
    game: { startedAt: null, deadlineAt: null, resumeSupported: false },
  }
}

describe('App formal intake persistence', () => {
  it('saves session, consent, demographics, and pre-task before entering the game', async () => {
    const paths: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      paths.push(path)
      if (path === '/api/sessions') return envelope({ ...context, created: true, mode: 'formal' }, 201)
      if (path === '/api/consent') return envelope({
        created: true, sessionId: context.sessionId, currentStep: 'demographics',
        consent: { accepted: true, version: 'consent-1.0.0', acceptedAt: '2026-08-01T00:00:00.000Z' },
      }, 201)
      if (path === '/api/demographics') return envelope({
        created: true, sessionId: context.sessionId, currentStep: 'pre_task',
        revisionNo: 1, demographics, submittedAt: '2026-08-01T00:01:00.000Z',
      }, 201)
      if (path.endsWith('/start')) return envelope({
        ...gameSnapshot,
        started: undefined,
        resumeSupported: undefined,
        created: true,
        sessionId: context.sessionId,
        currentStep: 'playing',
        candidateDisplayOrder: context.candidateDisplayOrder,
        initialOpenedCandidate: context.initialOpenedCandidate,
      }, 201)
      if (path.endsWith('/materials')) return envelope({
        sessionId: context.sessionId,
        materialVersion: context.versions.material,
        candidates: context.candidateDisplayOrder.map((id) => candidates.find((candidate) => candidate.id === id)),
      })
      return envelope({
        created: true, sessionId: context.sessionId, currentStep: 'game_ready',
        submissionId: '44444444-4444-4444-8444-444444444444', itemCount: 5,
      }, 201)
    })
    const identity = await startFormal()
    await act(async () => identity.props.onSubmit({ fullName: 'Memory Only' }))
    expect(renderer!.root.findAllByType(DemographicForm)).toHaveLength(1)
    await act(async () => renderer!.root.findByType(DemographicForm).props.onSubmit(demographics))
    await act(async () => renderer!.root.findByType(StateAssessmentScreen).props.onSubmit(preTask, {
      touched: { stress: true, fatigue: true, attention: true, mood: true, physicalDiscomfort: true },
      startedAt: '2026-08-01T00:02:00.000Z',
      submittedAt: '2026-08-01T00:03:00.000Z',
    }))

    expect(paths).toEqual([
      '/api/sessions', '/api/consent', '/api/demographics', '/api/questionnaires',
      `/api/sessions/${context.sessionId}/start`,
      `/api/sessions/${context.sessionId}/materials`,
    ])
    expect(renderer!.root.findAllByType(GameScreen)).toHaveLength(1)
    const stored = localStorage.getItem(FORMAL_SESSION_STORAGE_KEY) ?? ''
    expect(JSON.parse(stored).currentStep).toBe('playing')
    expect(stored).not.toMatch(/Memory Only|ageRange|stress|phone|studentId/i)
    for (const key of [
      PENDING_CREATION_KEY_STORAGE_KEY,
      PENDING_CONSENT_KEY_STORAGE_KEY,
      PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY,
      PENDING_PRE_TASK_KEY_STORAGE_KEY,
    ]) expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('does not recreate or re-upload identity when consent persistence needs a retry', async () => {
    const calls: Array<{ path: string; body: string }> = []
    let consentAttempts = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      calls.push({ path, body: String(init?.body ?? '') })
      if (path === '/api/sessions') return envelope({ ...context, created: true, mode: 'formal' }, 201)
      consentAttempts += 1
      if (consentAttempts === 1) throw new Error('offline')
      return envelope({
        created: false, sessionId: context.sessionId, currentStep: 'demographics',
        consent: { accepted: true, version: 'consent-1.0.0', acceptedAt: '2026-08-01T00:00:00.000Z' },
      })
    })
    const identity = await startFormal()
    await act(async () => { await expect(identity.props.onSubmit({ studentId: 'PRIVATE-1' })).rejects.toThrow() })
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).not.toBeNull()
    const retry = renderer!.root.findByProps({ 'data-testid': 'retry-formal-consent' })
    await act(async () => retry.props.onClick())

    expect(calls.filter((call) => call.path === '/api/sessions')).toHaveLength(1)
    expect(calls.filter((call) => call.body.includes('PRIVATE-1'))).toHaveLength(1)
    expect(renderer!.root.findAllByType(DemographicForm)).toHaveLength(1)
  })

  it('keeps a failed demographic or pre-task submission on the same screen with its operation key', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/sessions') return envelope({ ...context, created: true, mode: 'formal' }, 201)
      if (path === '/api/consent') return envelope({
        created: true, sessionId: context.sessionId, currentStep: 'demographics',
        consent: { accepted: true, version: 'consent-1.0.0', acceptedAt: '2026-08-01T00:00:00.000Z' },
      }, 201)
      throw new Error('offline')
    })
    const identity = await startFormal()
    await act(async () => identity.props.onSubmit({ fullName: 'Temporary' }))
    await act(async () => {
      await expect(renderer!.root.findByType(DemographicForm).props.onSubmit(demographics)).rejects.toThrow()
    })
    expect(renderer!.root.findAllByType(DemographicForm)).toHaveLength(1)
    expect(sessionStorage.getItem(PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/i)
  })
})

describe('App formal refresh recovery', () => {
  it.each([
    ['consent_pending', ConsentScreen],
    ['demographics', DemographicForm],
    ['pre_task', StateAssessmentScreen],
    ['game_ready', GameScreen],
  ] as const)('restores server step %s to the correct screen', async (step, Component) => {
    localStorage.setItem(FORMAL_SESSION_STORAGE_KEY, JSON.stringify({ ...context, currentStep: step }))
    globalThis.fetch = vi.fn(async () => envelope(resumeData(step)))
    await renderApp()
    expect(renderer!.root.findAllByType(Component)).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/sessions/${context.sessionId}/resume`,
      { method: 'GET', credentials: 'include' },
    )
  })

  it('does not call resume without a safe context and clears corrupt JSON', async () => {
    globalThis.fetch = vi.fn()
    await renderApp()
    expect(renderer!.root.findAllByType(StartScreen)).toHaveLength(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    act(() => renderer!.unmount())
    renderer = undefined

    localStorage.setItem(FORMAL_SESSION_STORAGE_KEY, '{broken')
    await renderApp()
    expect(renderer!.root.findAllByType(StartScreen)).toHaveLength(1)
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('clears unauthorized context but preserves it across a retryable network failure', async () => {
    localStorage.setItem(FORMAL_SESSION_STORAGE_KEY, JSON.stringify(context))
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'SESSION_UNAUTHORIZED', message: 'Expired.' },
      requestId: 'request-auth',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    await renderApp()
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()
    expect(renderer!.root.findAllByProps({ 'data-testid': 'formal-session-expired' })).toHaveLength(1)
    act(() => renderer!.unmount())
    renderer = undefined

    localStorage.setItem(FORMAL_SESSION_STORAGE_KEY, JSON.stringify(context))
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
    await renderApp()
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).not.toBeNull()
    expect(renderer!.root.findAllByProps({ 'data-testid': 'formal-recovery-retry' })).toHaveLength(1)
  })

  it('restores a playing session from the authoritative server snapshot without restarting it', async () => {
    localStorage.setItem(FORMAL_SESSION_STORAGE_KEY, JSON.stringify({ ...context, currentStep: 'playing' }))
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/materials')
      ? envelope({
          sessionId: context.sessionId,
          materialVersion: context.versions.material,
          candidates: context.candidateDisplayOrder.map((id) => candidates.find((candidate) => candidate.id === id)),
        })
      : envelope({
          session: { ...context, currentStep: 'playing', mode: 'formal' },
          consent: null,
          demographics: null,
          preTask: null,
          game: gameSnapshot,
        }))
    await renderApp()
    const game = renderer!.root.findByType(GameScreen)
    expect(game.props.formalGameSnapshot).toEqual({
      ...gameSnapshot, sunkCost: null, finalDecision: null,
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/sessions/${context.sessionId}/resume`,
      { method: 'GET', credentials: 'include' },
    )
  })

  it('keeps quick mode out of every formal API and formal persistence key', async () => {
    globalThis.fetch = vi.fn()
    await renderApp()
    act(() => renderer!.root.findByType(StartScreen).props.onStart('quick'))
    expect(renderer!.root.findAllByType(GameScreen)).toHaveLength(1)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()
    for (const key of [
      PENDING_CREATION_KEY_STORAGE_KEY,
      PENDING_CONSENT_KEY_STORAGE_KEY,
      PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY,
      PENDING_PRE_TASK_KEY_STORAGE_KEY,
    ]) expect(sessionStorage.getItem(key)).toBeNull()
  })
})
