import { create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { AdminFormalAssessmentReport } from './AdminFormalAssessmentReport'

describe('AdminFormalAssessmentReport', () => {
  it('renders server-backed choices and labels unavailable metrics without fabricating an RDI or level', () => {
    const tree = create(<AdminFormalAssessmentReport report={{
      sessionSummary: { sessionId: '12345678-1234-4234-8234-123456789012', status: 'completed', currentStep: 'completed', startedAt: '2026-08-05T00:00:00.000Z', completedAt: '2026-08-05T00:10:00.000Z', completionType: 'active' },
      versions: { config: 'config-2026-07-v1', task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1', sunkCostRule: 'sunk-1.0.0', scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null, reliability: null },
      stageChoices: { t1: { candidateId: 'B', confidence: 70, submittedAt: '2026-08-05T00:02:00.000Z' }, t2: null, t3: null },
      finalDecision: { candidateId: 'D', confidence: 78, submitMode: 'active', sourceStage: 'T3', submittedAt: '2026-08-05T00:10:00.000Z' },
      stageRatings: [{ candidateId: 'B', stage: 'T1', ratingValue: 65, submittedAt: '2026-08-05T00:01:00.000Z', sequenceNo: 2 }],
      evidenceSummary: { sequence: [], pointLedger: [] }, pointSummary: { totalPoints: 5, remainingPoints: 1, usedPoints: 4, shallowCount: 1, deepCount: 1 },
      sunkCostSummary: null,
      derivedMetrics: [{ metricCode: 'RES', numericValue: null, calculationStatus: 'pending_parameters', missingReason: 'parameters_not_enabled', computedAt: '2026-08-05T00:10:00.000Z' }],
      candidateSummaries: [{ candidateId: 'D', name: '候选人 D', role: 'AI 测评产品助理（实习生）', benchmarkValue: 83 }],
    }} />)
    const text = JSON.stringify(tree.toJSON())
    expect(text).toContain('正式测评结果报告')
    expect(text).toContain('候选人 B')
    expect(text).toContain('候选人 D')
    expect(text).toContain('未计算')
    expect(text).not.toContain('高韧性')
    expect(text).not.toContain('RDI 66')
  })
})
