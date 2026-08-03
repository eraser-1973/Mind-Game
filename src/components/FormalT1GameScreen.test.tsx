import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormalGameSnapshot } from '../types/formalGame'
import type { FormalSessionContext } from '../types/game'
import { candidates } from '../data/candidates'

const api = vi.hoisted(() => ({
  start: vi.fn(),
  rate: vi.fn(),
  choose: vi.fn(),
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

import { FormalCandidateDetail } from './FormalCandidateDetail'
import { FormalEvidencePanel } from './FormalEvidencePanel'
import { FormalT1CompletePanel } from './FormalT1CompletePanel'
import { FormalT1GameScreen } from './FormalT1GameScreen'
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
    task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1', sunkCostRule: 'sunk-1.0.0',
    scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null,
  },
  candidateDisplayOrder: ['B', 'A', 'E', 'C', 'D'],
  initialOpenedCandidate: 'B',
  currentStep: 'playing',
  createdAt: '2026-08-01T00:00:00.000Z',
}

const baseSnapshot: FormalGameSnapshot = {
  started: true, resumeSupported: true, durationSec: 900,
  startedAt: '2026-08-01T00:00:00.000Z', deadlineAt: '2099-08-01T00:15:00.000Z',
  serverNow: '2026-08-01T00:00:00.000Z', remainingSec: 900, expired: false,
  currentStage: 'T1', stageStatus: 'T1_ACTIVE', points: { total: 5, remaining: 5 },
  ratings: [], stageChoice: null, stageChoices: [], evidenceUnlocks: [], lastSequenceNo: 1,
}

let renderer: ReactTestRenderer | undefined
let originalWindow: typeof globalThis.window | undefined

beforeEach(() => {
  api.start.mockReset()
  api.rate.mockReset()
  api.choose.mockReset()
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

describe('FormalT1GameScreen server state behavior', () => {
  it('uses the server candidate order and never calls start for a restored snapshot', () => {
    renderer = create(<FormalT1GameScreen session={context} initialSnapshot={baseSnapshot} initialMaterials={candidates} onExit={vi.fn()} />)
    const detail = renderer.root.findByType(FormalCandidateDetail)
    expect(detail.props.candidate.id).toBe('B')
    expect(api.start).not.toHaveBeenCalled()
  })

  it('seals a rating only after server success', async () => {
    api.rate.mockResolvedValue({
      created: true, sessionId: context.sessionId, candidateId: 'B', stage: 'T1',
      ratingValue: 73, evidenceIdsSeen: [], sealed: true, sequenceNo: 2,
      serverSubmittedAt: '2026-08-01T00:01:00.000Z', ratedCandidateCount: 1,
      requiredCandidateCount: 5, allStageRated: false, allT1Rated: false,
    })
    renderer = create(<FormalT1GameScreen session={context} initialSnapshot={baseSnapshot} initialMaterials={candidates} onExit={vi.fn()} />)
    await act(async () => renderer!.root.findByType(FormalCandidateDetail).props.onSubmit(73))
    expect(renderer.root.findByType(FormalCandidateDetail).props.rating).toMatchObject({ ratingValue: 73, sealed: true })
    expect(api.rate).toHaveBeenCalledTimes(1)
  })

  it('retains an unsealed control and reuses the same UUID after a network failure', async () => {
    api.rate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      created: true, sessionId: context.sessionId, candidateId: 'B', stage: 'T1',
      ratingValue: 60, evidenceIdsSeen: [], sealed: true, sequenceNo: 2,
      serverSubmittedAt: '2026-08-01T00:01:00.000Z', ratedCandidateCount: 1,
      requiredCandidateCount: 5, allStageRated: false, allT1Rated: false,
    })
    renderer = create(<FormalT1GameScreen session={context} initialSnapshot={baseSnapshot} initialMaterials={candidates} onExit={vi.fn()} />)
    await act(async () => renderer!.root.findByType(FormalCandidateDetail).props.onSubmit(60))
    expect(renderer.root.findByType(FormalCandidateDetail).props.rating).toBeUndefined()
    await act(async () => renderer!.root.findByType(FormalCandidateDetail).props.onSubmit(60))
    expect(api.rate.mock.calls[0][1]).toBe(api.rate.mock.calls[1][1])
    const stored = [...(window.sessionStorage as unknown as MemoryStorage).values.values()]
    expect(stored.every((value) => /^[0-9a-f-]{36}$/i.test(value))).toBe(true)
    expect(JSON.stringify(stored)).not.toContain('60')
  })

  it('shows stage choice only after five server ratings and opens server verification after choice success', async () => {
    const ratings = context.candidateDisplayOrder.map((candidateId, index) => ({
      candidateId, stage: 'T1' as const, ratingValue: index * 20,
      evidenceIdsSeen: [], sealed: true as const, sequenceNo: index + 2,
      serverSubmittedAt: '2026-08-01T00:01:00.000Z',
    }))
    api.choose.mockResolvedValue({
      created: true, sessionId: context.sessionId, stage: 'T1', candidateId: 'D',
      confidence: 0, sealed: true, currentStage: 'T1_COMPLETE', stageStatus: 'T1_COMPLETE', sequenceNo: 7,
      serverSubmittedAt: '2026-08-01T00:05:00.000Z',
    })
    renderer = create(<FormalT1GameScreen session={context} initialSnapshot={{ ...baseSnapshot, ratings, lastSequenceNo: 6 }} initialMaterials={candidates} onExit={vi.fn()} />)
    expect(renderer.root.findAllByType(StageChoicePanel)).toHaveLength(1)
    await act(async () => renderer!.root.findByType(StageChoicePanel).props.onSubmit('D', 0))
    expect(renderer.root.findAllByType(FormalEvidencePanel)).toHaveLength(1)
    expect(renderer.root.findAllByType(FormalT1CompletePanel)).toHaveLength(0)
  })

  it('locks all submissions on an expired server snapshot', () => {
    renderer = create(<FormalT1GameScreen session={context} initialSnapshot={{ ...baseSnapshot, expired: true, remainingSec: 0 }} initialMaterials={candidates} onExit={vi.fn()} />)
    expect(renderer.root.findAllByProps({ 'data-testid': 'formal-timeout-saving' })).toHaveLength(1)
    expect(renderer.root.findAllByType(FormalCandidateDetail)).toHaveLength(0)
  })
})
