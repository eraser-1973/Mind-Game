import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormalGameSnapshot } from '../types/formalGame'
import type { FormalSessionContext } from '../types/game'

const materialsApi = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api/formalMaterials', () => ({ getFormalMaterials: materialsApi.get }))

import { FormalGameScreen } from './FormalGameScreen'

const session: FormalSessionContext = {
  participantId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222',
  configSetId: 'config-2026-07-v1', versions: { task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1', sunkCostRule: 'sunk-1.0.0', scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null },
  candidateDisplayOrder: ['A', 'B', 'C', 'D', 'E'], initialOpenedCandidate: 'A', currentStep: 'playing', createdAt: '2026-08-03T00:00:00.000Z',
}
const snapshot: FormalGameSnapshot = {
  started: true, resumeSupported: true, durationSec: 900, startedAt: '2026-08-03T00:00:00.000Z',
  deadlineAt: '2099-08-03T00:15:00.000Z', serverNow: '2026-08-03T00:00:00.000Z', remainingSec: 900,
  expired: false, currentStage: 'T1', stageStatus: 'T1_ACTIVE', points: { total: 5, remaining: 5 },
  ratings: [], stageChoice: null, stageChoices: [], evidenceUnlocks: [], lastSequenceNo: 1,
}

let renderer: ReactTestRenderer | undefined
let originalWindow: typeof globalThis.window

beforeEach(() => {
  originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        length: 0,
        clear: vi.fn(),
        getItem: vi.fn(() => null),
        key: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    },
  })
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  materialsApi.get.mockReset()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

describe('formal server material loading', () => {
  it('shows an explicit retry state and never falls back to bundled Quick candidates', async () => {
    materialsApi.get.mockRejectedValue(new Error('offline'))
    await act(async () => { renderer = create(<FormalGameScreen session={session} initialSnapshot={snapshot} onExit={vi.fn()} />) })
    expect(renderer!.root.findAllByProps({ 'data-testid': 'formal-materials-error' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'data-testid': 'formal-t1-game' })).toHaveLength(0)
    expect(materialsApi.get).toHaveBeenCalledWith(session.sessionId)
  })
})
