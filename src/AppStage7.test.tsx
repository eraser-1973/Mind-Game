import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { FormalCompletionScreen } from './components/FormalCompletionScreen'
import { FormalCompletionPendingScreen } from './components/FormalCompletionPendingScreen'
import { StateAssessmentScreen } from './components/StateAssessmentScreen'
import { TaskExperienceScreen } from './components/TaskExperienceScreen'
import type {
  FormalSessionContext,
  StateAssessmentData,
  TaskExperienceData,
} from './types/game'
import {
  FORMAL_SESSION_STORAGE_KEY,
  PENDING_COMPLETION_KEY_STORAGE_KEY,
  PENDING_POST_TASK_KEY_STORAGE_KEY,
  PENDING_TASK_EXPERIENCE_KEY_STORAGE_KEY,
} from './utils/formalSessionStorage'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

const sessionId = '22222222-2222-4222-8222-222222222222'
const context: FormalSessionContext = {
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId,
  configSetId: 'config-2026-07-v1',
  versions: {
    task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1',
    sunkCostRule: 'sunk-1.0.0', scoring: 'RDI-2.0-prepilot',
    benchmark: 'benchmark-1.0.0', norm: null,
  },
  candidateDisplayOrder: ['B', 'D', 'E', 'C', 'A'],
  initialOpenedCandidate: 'B',
  currentStep: 'post_task',
  createdAt: '2026-08-01T00:00:00.000Z',
}

const postValues: StateAssessmentData = {
  stress: 0, fatigue: 1, attention: 2, mood: 3, physicalDiscomfort: 4,
}
const taskValues = Object.fromEntries([
  'timePressure1', 'timePressure2', 'resourceLimit1', 'resourceLimit2',
  'socialEvaluation1', 'socialEvaluation2', 'outcomeResponsibility1',
  'outcomeResponsibility2', 'uncontrollability1', 'uncontrollability2',
  'cognitiveLoad1', 'cognitiveLoad2', 'cognitiveLoad3', 'cognitiveLoad4',
  'decisionConfidence',
].map((id) => [id, id === 'decisionConfidence' ? 0 : 1])) as TaskExperienceData

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'stage7-request' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function resumeData(step: 'post_task' | 'task_experience' | 'completion_pending' | 'completed') {
  return {
    session: { ...context, currentStep: step, mode: 'formal' },
    consent: null,
    demographics: null,
    preTask: null,
    game: {
      started: true,
      resumeSupported: true,
      durationSec: 900,
      startedAt: '2026-08-01T00:00:00.000Z',
      deadlineAt: '2026-08-01T00:15:00.000Z',
      serverNow: '2026-08-01T00:20:00.000Z',
      remainingSec: 0,
      expired: true,
      currentStage: 'DECISION',
      stageStatus: 'DECISION_COMPLETE',
      points: { total: 5, remaining: 2 },
      ratings: [],
      stageChoice: null,
      stageChoices: [],
      evidenceUnlocks: [],
      lastSequenceNo: step === 'post_task' ? 17 : step === 'task_experience' ? 18 : step === 'completion_pending' ? 19 : 20,
    },
    sunkCost: null,
    finalDecision: {
      created: false,
      finalDecisionId: '33333333-3333-4333-8333-333333333333',
      candidateId: 'B',
      confidence: 75,
      submitMode: 'active',
      sourceStage: 'T2',
      selectionOrigin: 'active_user',
      autoSelected: false,
      serverSubmittedAt: '2026-08-01T00:15:00.000Z',
      sequenceNo: 17,
      remainingSec: 1,
      pointsRemaining: 2,
      currentStep: 'post_task',
    },
    postTask: step === 'post_task'
      ? { saved: false }
      : { saved: true, instrumentVersion: 'state-assessment-post-1.0.0', itemCount: 5, sequenceNo: 18, serverSubmittedAt: '2026-08-01T00:16:00.000Z' },
    taskExperience: ['completion_pending', 'completed'].includes(step)
      ? { saved: true, instrumentVersion: 'task-experience-1.0.0', itemCount: 15, sequenceNo: 19, serverSubmittedAt: '2026-08-01T00:18:00.000Z' }
      : { saved: false },
    completion: step === 'completed'
      ? { completed: true, completionStatus: 'completed', finalSubmitMode: 'active', serverCompletedAt: '2026-08-01T00:19:00.000Z', sequenceNo: 20 }
      : { completed: false },
  }
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
  act(() => renderer?.unmount())
  renderer = undefined
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function renderAt(step: 'post_task' | 'task_experience' | 'completion_pending' | 'completed') {
  localStorage.setItem(FORMAL_SESSION_STORAGE_KEY, JSON.stringify({ ...context, currentStep: step }))
  await act(async () => { renderer = create(<App />) })
  return renderer!
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('App Stage 7 formal post-task flow', () => {
  it('submits both sealed questionnaires, ends the session, and shows a neutral thank-you page', async () => {
    const paths: string[] = []
    const bodies: unknown[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      paths.push(path)
      if (init?.body) bodies.push(JSON.parse(String(init.body)))
      if (path.endsWith('/resume')) return envelope(resumeData('post_task'))
      if (path === '/api/questionnaires') {
        const body = bodies.at(-1) as { phase: string; answers: unknown[] }
        return envelope({
          created: true,
          sessionId,
          currentStep: body.phase === 'post' ? 'task_experience' : 'completion_pending',
          submissionId: crypto.randomUUID(),
          itemCount: body.answers.length,
          sequenceNo: body.phase === 'post' ? 18 : 19,
        }, 201)
      }
      if (path.endsWith('/end')) return envelope({
        created: true,
        alreadyCompleted: false,
        sessionId,
        currentStep: 'completed',
        completionStatus: 'completed',
        finalSubmitMode: 'active',
        serverCompletedAt: '2026-08-01T00:19:00.000Z',
        sequenceNo: 20,
      }, 201)
      throw new Error(`Unexpected path: ${path}`)
    })

    await renderAt('post_task')
    expect(renderer!.root.findByType(StateAssessmentScreen).props.phase).toBe('after')
    await act(async () => renderer!.root.findByType(StateAssessmentScreen).props.onSubmit(postValues, {
      touched: { stress: true, fatigue: true, attention: true, mood: true, physicalDiscomfort: true },
      startedAt: '2026-08-01T00:16:00.000Z',
      submittedAt: '2026-08-01T00:17:00.000Z',
    }))
    expect(renderer!.root.findAllByType(TaskExperienceScreen)).toHaveLength(1)
    await act(async () => renderer!.root.findByType(TaskExperienceScreen).props.onSubmit(taskValues, {
      touched: Object.fromEntries(Object.keys(taskValues).map((id) => [id, true])),
      submittedAt: '2026-08-01T00:18:00.000Z',
    }))
    await act(async () => undefined)

    expect(renderer!.root.findAllByType(FormalCompletionScreen)).toHaveLength(1)
    const html = JSON.stringify(renderer!.toJSON())
    expect(html).toContain('提交成功')
    expect(html).not.toMatch(/RDI|高韧性|中间型|脆弱型|导出 JSON|候选人推荐|超时样本/i)
    expect(paths).toEqual([
      `/api/sessions/${sessionId}/resume`,
      '/api/questionnaires',
      '/api/questionnaires',
      `/api/sessions/${sessionId}/end`,
    ])
    expect((bodies[0] as { answers: unknown[] }).answers).toHaveLength(5)
    expect((bodies[1] as { answers: unknown[] }).answers).toHaveLength(15)
    expect(JSON.stringify(bodies)).not.toMatch(/fullName|studentId|phone|RDI|score|level/i)
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).toContain('"currentStep":"completed"')
    expect(JSON.stringify([...localStorage.values])).not.toMatch(/stress|timePressure|decisionConfidence/i)
  })

  it.each([
    ['task_experience', TaskExperienceScreen],
    ['completed', FormalCompletionScreen],
  ] as const)('restores %s directly to the sealed server step', async (step, Component) => {
    globalThis.fetch = vi.fn(async () => envelope(resumeData(step)))
    await renderAt(step)
    expect(renderer!.root.findAllByType(Component)).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('resumes completion_pending by retrying only the idempotent end operation', async () => {
    const paths: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      paths.push(path)
      if (path.endsWith('/resume')) return envelope(resumeData('completion_pending'))
      return envelope({
        created: false,
        alreadyCompleted: true,
        sessionId,
        currentStep: 'completed',
        completionStatus: 'completed',
        finalSubmitMode: 'active',
        serverCompletedAt: '2026-08-01T00:19:00.000Z',
        sequenceNo: 20,
      })
    })
    await renderAt('completion_pending')
    await flushEffects()
    expect(renderer!.root.findAllByType(FormalCompletionScreen)).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(paths).toEqual([
      `/api/sessions/${sessionId}/resume`,
      `/api/sessions/${sessionId}/end`,
    ])
    expect(renderer!.root.findAllByType(FormalCompletionScreen)).toHaveLength(1)
  })

  it('keeps a failed end key for retry and clears all safe pointers only on explicit return home', async () => {
    let endAttempts = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/resume')) return envelope(resumeData('completion_pending'))
      endAttempts += 1
      if (endAttempts === 1) throw new Error('offline')
      return envelope({
        created: true, alreadyCompleted: false, sessionId,
        currentStep: 'completed', completionStatus: 'completed', finalSubmitMode: 'active',
        serverCompletedAt: '2026-08-01T00:19:00.000Z', sequenceNo: 20,
      }, 201)
    })
    await renderAt('completion_pending')
    await flushEffects()
    expect(renderer!.root.findAllByType(FormalCompletionPendingScreen)).toHaveLength(1)
    expect(sessionStorage.getItem(PENDING_COMPLETION_KEY_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/i)
    const retry = renderer!.root.findByProps({ 'data-testid': 'retry-formal-completion' })
    await act(async () => retry.props.onClick())
    expect(renderer!.root.findAllByType(FormalCompletionScreen)).toHaveLength(1)
    expect(sessionStorage.getItem(PENDING_COMPLETION_KEY_STORAGE_KEY)).toBeNull()

    act(() => renderer!.root.findByProps({ 'data-testid': 'formal-completion-home' }).props.onClick())
    expect(localStorage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()
    expect(sessionStorage.getItem(PENDING_POST_TASK_KEY_STORAGE_KEY)).toBeNull()
    expect(sessionStorage.getItem(PENDING_TASK_EXPERIENCE_KEY_STORAGE_KEY)).toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })
})
