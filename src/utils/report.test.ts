import { describe, expect, it } from 'vitest'
import { createInitialGameState, gameReducer } from '../state/gameReducer'
import { generateReport } from './report'

describe('generateReport', () => {
  it('builds explanatory metrics and preserves raw runtime data', () => {
    let state = createInitialGameState('quick', 1_000)
    state = gameReducer(state, {
      type: 'RATE',
      candidateId: 'C',
      stage: 'T1',
      value: 60,
    })
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'C',
      verifyType: 'deep',
    })
    state = gameReducer(state, {
      type: 'RATE',
      candidateId: 'C',
      stage: 'T3',
      value: 88,
    })
    state = { ...state, finalCandidateId: 'C', phase: 'report' }

    const report = generateReport(state)

    expect(report.selectedCandidate.id).toBe('C')
    expect(report.roi.note).toContain('真实能力值')
    expect(report.revisions).toHaveLength(5)
    expect(report.rdi.rawData.selectedAbility).toBe(88)
    expect(report.runtime.C.deepCount).toBe(1)
  })
})
