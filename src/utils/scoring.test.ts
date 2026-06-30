import { describe, expect, it } from 'vitest'
import { candidates } from '../data/candidates'
import type { GameLog, RDIInput } from '../types/game'
import {
  calculateRDI,
  calculateROI,
  calculateRevisionSlope,
  classifyLossAversion,
  classifyStrategy,
  detectAttentionDisengagementFailure,
} from './scoring'

const baseLog = (
  overrides: Partial<GameLog> & Pick<GameLog, 'id' | 'type' | 'elapsedSec'>,
): GameLog => ({
  timeLeftSec: 900 - overrides.elapsedSec,
  pressureStage: 'green',
  responseTimeSec: 1,
  detail: '',
  ...overrides,
})

describe('calculateROI', () => {
  it('marks a zero-point hire as unverified and returns true ability', () => {
    expect(calculateROI(candidates[2], 0)).toEqual({
      value: 88,
      note: '未查证直接录用',
      unverifiedHire: true,
    })
  })

  it('divides ability by spent points', () => {
    expect(calculateROI(candidates[2], 4).value).toBe(22)
  })
})

describe('calculateRevisionSlope', () => {
  it('uses the last available rating when T3 is absent', () => {
    const result = calculateRevisionSlope({
      T1: { value: 70, elapsedSec: 10 },
      T2: { value: 50, elapsedSec: 30 },
    })

    expect(result).toMatchObject({
      value: -1,
      delta: -20,
      fromStage: 'T1',
      toStage: 'T2',
      elapsedSec: 20,
    })
  })
})

describe('attention and strategy classification', () => {
  it('detects continued investment in a toxic candidate after negative evidence', () => {
    const logs = [
      baseLog({
        id: '1',
        type: 'verify',
        elapsedSec: 20,
        candidateId: 'A',
        pointsSpent: 1,
        negativeEvidenceSeen: true,
      }),
      baseLog({
        id: '2',
        type: 'verify',
        elapsedSec: 30,
        candidateId: 'A',
        pointsSpent: 3,
        negativeEvidenceSeen: true,
        addedAfterNegative: true,
      }),
    ]

    expect(detectAttentionDisengagementFailure(logs).failed).toBe(true)
  })

  it('recognizes broad shallow screening followed by focused deep verification', () => {
    const logs = [
      baseLog({ id: '1', type: 'verify', verifyType: 'shallow', candidateId: 'C', elapsedSec: 10, pointsSpent: 1 }),
      baseLog({ id: '2', type: 'verify', verifyType: 'shallow', candidateId: 'D', elapsedSec: 15, pointsSpent: 1 }),
      baseLog({ id: '3', type: 'verify', verifyType: 'deep', candidateId: 'C', elapsedSec: 25, pointsSpent: 3 }),
    ]

    expect(classifyStrategy(logs)).toBe('目标导向型')
  })

  it('recognizes an early large halo-candidate investment as a shortcut', () => {
    const logs = [
      baseLog({ id: '1', type: 'verify', verifyType: 'deep', candidateId: 'A', elapsedSec: 8, pointsSpent: 3 }),
    ]

    expect(classifyStrategy(logs)).toBe('习惯性捷径型')
  })
})

describe('loss aversion and RDI', () => {
  it.each([
    ['continue', '高损失厌恶'],
    ['stop_loss', '理性止损'],
    ['give_up', '极端风险规避或高元认知'],
    [null, '未触发或未作答'],
  ] as const)('maps %s to an explanation', (choice, expected) => {
    expect(classifyLossAversion(choice)).toContain(expected)
  })

  it('returns a bounded weighted score and preserves raw data', () => {
    const input: RDIInput = {
      selectedAbility: 88,
      selectedFit: 91,
      attentionFailed: false,
      strategy: '目标导向型',
      lossChoice: 'stop_loss',
      revisionQuality: 85,
    }
    const result = calculateRDI(input)

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.level).toBe('高韧性')
    expect(result.rawData).toEqual(input)
  })
})
