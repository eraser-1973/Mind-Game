import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormalEvidenceUnlock, FormalGameSnapshot } from '../types/formalGame'
import type { FormalSessionContext } from '../types/game'

const api = vi.hoisted(() => ({
  start: vi.fn(),
  rate: vi.fn(),
  choose: vi.fn(),
  unlock: vi.fn(),
}))

vi.mock('../api/formalGame', async () => {
  const actual = await vi.importActual<typeof import('../api/formalGame')>('../api/formalGame')
  return {
    ...actual,
    startFormalGame: api.start,
    submitFormalRating: api.rate,
    submitFormalStageChoice: api.choose,
  }
})

vi.mock('../api/formalEvidence', () => ({ unlockFormalEvidence: api.unlock }))

import { FormalEvidencePanel } from './FormalEvidencePanel'
import { FormalCandidateDetail } from './FormalCandidateDetail'
import { FormalGameScreen } from './FormalGameScreen'
import { FormalInvestigationStatus } from './FormalInvestigationStatus'
import { FormalRatingPanel } from './FormalRatingPanel'
import { NikoChatPanel } from './NikoChatPanel'
import { StageChoicePanel } from './StageChoicePanel'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

const context: FormalSessionContext = {
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  configSetId: 'config-2026-07-v1',
  versions: {
    task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1',
    scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null,
  },
  candidateDisplayOrder: ['B', 'A', 'E', 'C', 'D'],
  initialOpenedCandidate: 'B',
  currentStep: 'playing',
  createdAt: '2026-08-01T00:00:00.000Z',
}

const t1Ratings = context.candidateDisplayOrder.map((candidateId, index) => ({
  candidateId, stage: 'T1' as const, ratingValue: 40 + index,
  evidenceIdsSeen: [], sealed: true as const, sequenceNo: index + 2,
  serverSubmittedAt: '2026-08-01T00:01:00.000Z',
}))

const t1Choice = {
  stage: 'T1' as const, candidateId: 'B' as const, confidence: 70,
  sealed: true as const, sequenceNo: 7,
  serverSubmittedAt: '2026-08-01T00:02:00.000Z',
}

const baseSnapshot: FormalGameSnapshot = {
  started: true, resumeSupported: true, durationSec: 900,
  startedAt: '2026-08-01T00:00:00.000Z', deadlineAt: '2099-08-01T00:15:00.000Z',
  serverNow: '2026-08-01T00:00:00.000Z', remainingSec: 900, expired: false,
  currentStage: 'T1_COMPLETE', stageStatus: 'T1_COMPLETE',
  points: { total: 5, remaining: 5 }, ratings: t1Ratings,
  stageChoice: t1Choice, stageChoices: [t1Choice], evidenceUnlocks: [], lastSequenceNo: 7,
}

const shallowB: FormalEvidenceUnlock = {
  candidateId: 'B', level: 'shallow', ratingStage: 'T2', sequenceNo: 8,
  serverAt: '2026-08-01T00:03:00.000Z', points: { before: 5, cost: 1, after: 4 },
  evidence: [
    { id: 'B-t2-1', title: '调研报告与数据文件', content: '公开浅查材料一', polarity: 'positive', order: 1 },
    { id: 'B-t2-2', title: '实习证明与工作记录', content: '公开浅查材料二', polarity: 'positive', order: 2 },
  ],
}

const shallowA: FormalEvidenceUnlock = {
  candidateId: 'A', level: 'shallow', ratingStage: 'T2', sequenceNo: 9,
  serverAt: '2026-08-01T00:03:30.000Z', points: { before: 4, cost: 1, after: 3 },
  evidence: [
    { id: 'A-t2-1', title: '项目材料核验', content: '公开浅查材料一', polarity: 'negative', order: 1 },
    { id: 'A-t2-2', title: '贡献说明核验', content: '公开浅查材料二', polarity: 'negative', order: 2 },
  ],
}

let renderer: ReactTestRenderer | undefined
let originalWindow: typeof globalThis.window | undefined

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  originalWindow = globalThis.window
  const sessionStorage = new MemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
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
})

describe('FormalGameScreen Stage 5 server state', () => {
  it('shows shallow verification at T1_COMPLETE without rendering locked local evidence', () => {
    renderer = create(<FormalGameScreen session={context} initialSnapshot={baseSnapshot} onExit={vi.fn()} />)
    const panel = renderer.root.findByType(FormalEvidencePanel)
    expect(panel.props.canUnlockShallow).toBe(true)
    expect(panel.props.shallowUnlock).toBeUndefined()
    expect(renderer.root.findByType(FormalCandidateDetail).props.rating).toMatchObject({ stage: 'T1', sealed: true })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('报告共28页')
  })

  it('uses only the server unlock response for evidence and points, while a failure changes neither', async () => {
    api.unlock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      ...shallowB,
      created: true, alreadyUnlocked: false, sessionId: context.sessionId,
      currentStage: 'T2', stageStatus: 'T2_ACTIVE',
      points: { ...shallowB.points, total: 5 },
    })
    renderer = create(<FormalGameScreen session={context} initialSnapshot={baseSnapshot} onExit={vi.fn()} />)
    await act(async () => renderer!.root.findByType(FormalEvidencePanel).props.onUnlock('shallow'))
    let panel = renderer.root.findByType(FormalEvidencePanel)
    expect(panel.props.shallowUnlock).toBeUndefined()
    expect(panel.props.pointsRemaining).toBe(5)
    await act(async () => panel.props.onUnlock('shallow'))
    panel = renderer.root.findByType(FormalEvidencePanel)
    expect(panel.props.shallowUnlock.evidence[0].id).toBe('B-t2-1')
    expect(panel.props.pointsRemaining).toBe(4)
    expect(api.unlock.mock.calls[0][1]).toBe(api.unlock.mock.calls[1][1])
    const stored = [...(window.sessionStorage as unknown as MemoryStorage).values.values()]
    expect(JSON.stringify(stored)).not.toContain('公开浅查材料')
  })

  it('opens and seals T2 from server facts, then generates Niko feedback from public evidence', async () => {
    const snapshot: FormalGameSnapshot = {
      ...baseSnapshot,
      currentStage: 'T2', stageStatus: 'T2_ACTIVE',
      points: { total: 5, remaining: 3 }, evidenceUnlocks: [shallowB, shallowA], lastSequenceNo: 9,
    }
    api.rate.mockResolvedValue({
      created: true, sessionId: context.sessionId, candidateId: 'B', stage: 'T2',
      ratingValue: 75, evidenceIdsSeen: ['B-t2-1', 'B-t2-2'], sealed: true,
      sequenceNo: 10, serverSubmittedAt: '2026-08-01T00:04:00.000Z',
      ratedCandidateCount: 1, requiredCandidateCount: 2,
      allStageRated: false, allT1Rated: true,
    })
    renderer = create(<FormalGameScreen session={context} initialSnapshot={snapshot} onExit={vi.fn()} />)
    const rating = renderer.root.findByType(FormalRatingPanel)
    expect(rating.props.stage).toBe('T2')
    await act(async () => rating.props.onSubmit(75))
    expect(renderer.root.findByType(FormalRatingPanel).props.rating).toMatchObject({ ratingValue: 75, sealed: true })
    const niko = renderer.root.findByType(NikoChatPanel)
    expect(niko.props.messages).toHaveLength(1)
    expect(niko.props.messages[0]).toMatchObject({ mood: 'happy', relatedEvidenceId: 'B-t2-1' })
  })

  it('shows the T2 stage choice only after every shallow candidate has a sealed T2', () => {
    const t2Rating = {
      candidateId: 'B' as const, stage: 'T2' as const, ratingValue: 75,
      evidenceIdsSeen: ['B-t2-1', 'B-t2-2'], sealed: true as const,
      sequenceNo: 9, serverSubmittedAt: '2026-08-01T00:04:00.000Z',
    }
    renderer = create(<FormalGameScreen session={context} initialSnapshot={{
      ...baseSnapshot, currentStage: 'T2', stageStatus: 'T2_ACTIVE',
      points: { total: 5, remaining: 4 }, evidenceUnlocks: [shallowB],
      ratings: [...t1Ratings, t2Rating], lastSequenceNo: 9,
    }} onExit={vi.fn()} />)
    const choice = renderer.root.findByType(StageChoicePanel)
    expect(choice.props.stage).toBe('T2')
    expect(choice.props.title).toBe('证据初步核验后的选择')
  })

  it('shows the Stage 5 pause state after T3 is sealed and never renders a final decision', () => {
    renderer = create(<FormalGameScreen session={context} initialSnapshot={{
      ...baseSnapshot, currentStage: 'T3', stageStatus: 'T3_COMPLETE',
      points: { total: 5, remaining: 1 }, lastSequenceNo: 13,
    }} onExit={vi.fn()} />)
    const status = renderer.root.findByType(FormalInvestigationStatus)
    expect(status.props.kind).toBe('t3-complete')
    expect(JSON.stringify(renderer.toJSON())).toContain('最终录用将在下一阶段接入')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('提交最终录用')
  })

  it('keeps an expired T2 stage choice visible but disables every write control', () => {
    const t2Rating = {
      candidateId: 'B' as const, stage: 'T2' as const, ratingValue: 75,
      evidenceIdsSeen: ['B-t2-1', 'B-t2-2'], sealed: true as const,
      sequenceNo: 9, serverSubmittedAt: '2026-08-01T00:04:00.000Z',
    }
    renderer = create(<FormalGameScreen session={context} initialSnapshot={{
      ...baseSnapshot, currentStage: 'T2', stageStatus: 'T2_ACTIVE',
      expired: true, remainingSec: 0, points: { total: 5, remaining: 4 },
      evidenceUnlocks: [shallowB], ratings: [...t1Ratings, t2Rating], lastSequenceNo: 9,
    }} onExit={vi.fn()} />)
    const choice = renderer.root.findByType(StageChoicePanel)
    expect(choice.props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'data-testid': 'submit-t2-stage-choice' }).props.disabled).toBe(true)
  })
})
