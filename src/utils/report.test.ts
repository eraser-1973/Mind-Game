import { describe, expect, it } from 'vitest'
import { createInitialGameState, gameReducer } from '../state/gameReducer'
import { calculateRevisionQuality, generateReport } from './report'

describe('generateReport', () => {
  it('rewards upward revision for B and stable revision for E under the new framework', () => {
    const quality = calculateRevisionQuality([
      {
        candidate: {
          id: 'B',
          expectedUpdate: 'up',
        } as never,
        result: {
          value: 1,
          delta: 20,
          elapsedSec: 20,
          fromStage: 'T1',
          toStage: 'T3',
        },
      },
      {
        candidate: {
          id: 'E',
          expectedUpdate: 'stable',
        } as never,
        result: {
          value: 0,
          delta: 0,
          elapsedSec: 20,
          fromStage: 'T1',
          toStage: 'T3',
        },
      },
    ])

    expect(quality).toBe(95)
  })

  it('builds explanatory metrics and preserves raw runtime data', () => {
    const researchData = {
      participantId: 'MG-REPORT-001',
      formalSession: null,
      consent: {
        accepted: true,
        acceptedAt: '2026-07-26T00:00:00.000Z',
      },
      demographics: null,
      preTask: null,
      postTask: null,
      taskExperience: null,
      startedAt: '2026-07-26T00:00:00.000Z',
      completedAt: null,
    }
    let state = createInitialGameState('quick', 1_000, researchData)
    state = gameReducer(state, {
      type: 'RATE',
      candidateId: 'B',
      stage: 'T1',
      value: 60,
    })
    state = gameReducer(state, {
      type: 'VERIFY',
      candidateId: 'B',
      verifyType: 'deep',
    })
    state = gameReducer(state, {
      type: 'RATE',
      candidateId: 'C',
      stage: 'T3',
      value: 88,
    })
    state = { ...state, finalCandidateId: 'B', phase: 'report' }

    const report = generateReport(state)

    expect(report.selectedCandidate.id).toBe('B')
    expect(report.roi.note).toContain('后台岗位匹配基准分')
    expect(report.revisions).toHaveLength(5)
    expect(report.rdi.rawData.selectedAbility).toBe(86)
    expect(report.runtime.B.deepCount).toBe(1)
    expect(report.participantId).toBe('MG-REPORT-001')
    expect(report.researchData?.consent.accepted).toBe(true)
    expect(report.nikoMessages).toEqual([])
  })
})
