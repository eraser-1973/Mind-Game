import { describe, expect, it } from 'vitest'
import { deriveFormalStageStatus } from '../worker/domain/formalStage'

describe('deriveFormalStageStatus', () => {
  it.each([
    ['T1', [], 'T1_ACTIVE'],
    ['T1_COMPLETE', ['T1'], 'T1_COMPLETE'],
    ['T2', ['T1'], 'T2_ACTIVE'],
    ['T2', ['T1', 'T2'], 'T2_COMPLETE'],
    ['T3', ['T1', 'T2'], 'T3_ACTIVE'],
    ['T3', ['T1', 'T2', 'T3'], 'T3_COMPLETE'],
  ])('derives %s with %j as %s', (currentStage, sealedStages, expected) => {
    expect(deriveFormalStageStatus(currentStage, sealedStages)).toBe(expected)
  })
})
