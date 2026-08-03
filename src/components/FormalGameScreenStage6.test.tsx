import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormalGameSnapshot } from '../types/formalGame'
import type { FormalSessionContext } from '../types/game'
import { candidates } from '../data/candidates'

const api = vi.hoisted(() => ({
  show: vi.fn(), choice: vi.fn(), final: vi.fn(), timeout: vi.fn(),
  start: vi.fn(), rate: vi.fn(), stageChoice: vi.fn(), unlock: vi.fn(),
}))

vi.mock('../api/formalGame', async () => {
  const actual = await vi.importActual<typeof import('../api/formalGame')>('../api/formalGame')
  return {
    ...actual,
    startFormalGame: api.start,
    submitFormalRating: api.rate,
    submitFormalStageChoice: api.stageChoice,
    checkFormalSunkCost: api.show,
    submitFormalSunkCostChoice: api.choice,
    submitActiveFinalDecision: api.final,
    submitTimeoutFinalDecision: api.timeout,
  }
})
vi.mock('../api/formalEvidence', () => ({ unlockFormalEvidence: api.unlock }))

import { FormalFinalDecisionPanel } from './FormalFinalDecisionPanel'
import { FormalGameScreen } from './FormalGameScreen'
import { FormalPostTaskPause } from './FormalPostTaskPause'
import { FormalSunkCostModal } from './FormalSunkCostModal'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

const session: FormalSessionContext = {
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  configSetId: 'config-2026-07-v1',
  versions: { task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1',
    sunkCostRule: 'sunk-1.0.0', scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null },
  candidateDisplayOrder: ['B', 'A', 'E', 'C', 'D'], initialOpenedCandidate: 'B',
  currentStep: 'playing', createdAt: '2026-08-01T00:00:00.000Z',
}

const ratings = session.candidateDisplayOrder.map((candidateId, index) => ({
  candidateId, stage: 'T1' as const, ratingValue: 50, evidenceIdsSeen: [], sealed: true as const,
  sequenceNo: index + 1, serverSubmittedAt: '2026-08-01T00:01:00.000Z',
}))
const t1 = { stage: 'T1' as const, candidateId: 'B' as const, confidence: 60,
  sealed: true as const, sequenceNo: 6, serverSubmittedAt: '2026-08-01T00:02:00.000Z' }
const t2 = { ...t1, stage: 'T2' as const, candidateId: 'D' as const, sequenceNo: 9 }
const snapshot: FormalGameSnapshot = {
  started: true, resumeSupported: true, durationSec: 900,
  startedAt: '2026-08-01T00:00:00.000Z', deadlineAt: '2099-08-01T00:15:00.000Z',
  serverNow: '2026-08-01T00:10:00.000Z', remainingSec: 250, expired: false,
  currentStage: 'T2', stageStatus: 'T2_COMPLETE', points: { total: 5, remaining: 2 },
  ratings, stageChoice: t1, stageChoices: [t1, t2], evidenceUnlocks: [], lastSequenceNo: 9,
  sunkCost: null, finalDecision: null,
}

let renderer: ReactTestRenderer | undefined
let originalWindow: typeof globalThis.window | undefined
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  api.show.mockResolvedValue({ created: false, triggered: false, required: false })
  originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    sessionStorage: new MemoryStorage(), setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  } })
})
afterEach(() => {
  act(() => renderer?.unmount())
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

describe('Formal Stage 6 UI', () => {
  it('treats an explicit pointer interaction at displayed confidence zero as an answer', async () => {
    const onConfidenceChange = vi.fn()
    await act(async () => {
      renderer = create(<FormalFinalDecisionPanel
        candidates={[]}
        selectedId={null}
        confidence={0}
        confidenceTouched={false}
        canSubmit={false}
        pending={false}
        error={null}
        onSelect={vi.fn()}
        onConfidenceChange={onConfidenceChange}
        onSubmit={vi.fn()}
      />)
    })
    await act(async () => renderer!.root.findByType('input').props.onPointerDown())
    expect(onConfidenceChange).toHaveBeenCalledWith(0)
  })

  it('renders a server-gated neutral sunk cost modal with equal choice buttons', async () => {
    api.show.mockResolvedValue({
      created: true, triggered: true, required: true,
      sunkEventId: '33333333-3333-4333-8333-333333333333', targetCandidateId: 'A',
      pointsInvestedBefore: 2, shownAt: '2026-08-01T00:10:00.000Z', choice: null,
      choiceSubmittedAt: null, pointsAfterChoice: null,
    })
    await act(async () => { renderer = create(<FormalGameScreen session={session} initialSnapshot={snapshot} initialMaterials={candidates} onExit={vi.fn()} />) })
    const modal = renderer!.root.findByType(FormalSunkCostModal)
    const buttons = modal.findAllByType('button')
    expect(buttons).toHaveLength(3)
    expect(new Set(buttons.map((button) => button.props.className))).toEqual(new Set(['formal-neutral-choice']))
  })

  it('requires a touched confidence, submits immutable final data, then shows only the Stage 6 pause', async () => {
    api.final.mockResolvedValue({
      created: true, finalDecisionId: '44444444-4444-4444-8444-444444444444',
      candidateId: 'D', confidence: 0, submitMode: 'active', sourceStage: 'T2',
      selectionOrigin: 'active_user', autoSelected: false,
      serverSubmittedAt: '2026-08-01T00:11:00.000Z', sequenceNo: 10,
      remainingSec: 240, pointsRemaining: 2, currentStep: 'post_task',
    })
    await act(async () => { renderer = create(<FormalGameScreen session={session} initialSnapshot={snapshot} initialMaterials={candidates} onExit={vi.fn()} />) })
    const panel = renderer!.root.findByType(FormalFinalDecisionPanel)
    expect(panel.props.title).toBe('锁定最终录用人选')
    expect(panel.props.canSubmit).toBe(false)
    await act(async () => panel.props.onSelect('D'))
    expect(renderer!.root.findByType(FormalFinalDecisionPanel).props.canSubmit).toBe(false)
    await act(async () => renderer!.root.findByType(FormalFinalDecisionPanel).props.onConfidenceChange(0))
    await act(async () => renderer!.root.findByType(FormalFinalDecisionPanel).props.onSubmit())
    expect(api.final).toHaveBeenCalledWith(expect.objectContaining({ candidateId: 'D', confidence: 0 }), expect.any(String))
    expect(renderer!.root.findByType(FormalPostTaskPause)).toBeTruthy()
    expect(JSON.stringify(renderer!.toJSON())).toContain('最终录用结果已安全保存')
    expect(JSON.stringify(renderer!.toJSON())).not.toMatch(/RDI|导出 JSON|高韧性|脆弱型/)
  })
})
