import { describe, expect, it } from 'vitest'
import {
  validateExpertBenchmarkDocument,
  validateNormDocument,
  validateReliabilityDocument,
  validateScoringDefinitionDocument,
} from '../worker/domain/analysisConfiguration'
import { fingerprintExpertBenchmarkContent, fingerprintFormalAnalysisRun, fingerprintReliabilityContent, fingerprintScoringDefinitionContent } from '../worker/domain/analysisFingerprint'

const policies = [
  { candidateId: 'A', direction: -1, includeInCoreEac: true },
  { candidateId: 'B', direction: 1, includeInCoreEac: true },
  { candidateId: 'C', direction: -1, includeInCoreEac: true },
  { candidateId: 'D', direction: 1, includeInCoreEac: true },
  { candidateId: 'E', direction: 0, includeInCoreEac: false },
] as const

const experts = [
  { expertCode: 'expert-01', scores: { A: 52, B: 88, C: 61, D: 84, E: 70 } },
  { expertCode: 'expert-02', scores: { A: 56, B: 84, C: 59, D: 82, E: 72 } },
]

describe('analysis configuration domain validation', () => {
  it('changes a formal analysis fingerprint when any parameter content changes despite stable version IDs', async () => {
    const base = {
      sourceFacts: { sessionId: 's-1', sealedEventIds: ['e-1'] },
      versions: { scoringVersion: 'score-v1', benchmarkVersion: 'benchmark-v1', normVersion: 'norm-v1', reliabilityVersion: 'rel-v1' },
      fingerprints: { scoring: 'a'.repeat(64), benchmark: 'b'.repeat(64), norm: 'c'.repeat(64), reliability: 'd'.repeat(64) },
      parameterFacts: { weights: { RES: 1 }, policies: [{ candidateId: 'A', direction: -1 }] },
    }
    await expect(fingerprintFormalAnalysisRun(base)).resolves.toMatch(/^[0-9a-f]{64}$/)
    await expect(fingerprintFormalAnalysisRun({
      ...base,
      fingerprints: { ...base.fingerprints, reliability: 'e'.repeat(64) },
    })).resolves.not.toBe(await fingerprintFormalAnalysisRun(base))
  })

  it('keeps an expert benchmark fingerprint stable across matrix ordering', async () => {
    const ordered = {
      displayName: 'Expert panel', ratedAt: '2026-08-04T00:00:00.000Z',
      candidatePolicies: policies,
      experts,
    }
    const reordered = {
      ...ordered,
      candidatePolicies: [...policies].reverse(),
      experts: [...experts].reverse(),
    }
    expect(await fingerprintExpertBenchmarkContent(ordered)).toBe(
      await fingerprintExpertBenchmarkContent(reordered),
    )
  })

  it('excludes lifecycle revision from reliability and scoring content fingerprints', async () => {
    const reliability = { displayName: 'EAC', scoringVersion: 'rdi-v2', metricCode: 'EAC', sd: 5, reliability: 0.8, sampleSize: 24, populationNote: 'Cohort', expectedRevision: 1 }
    await expect(fingerprintReliabilityContent(reliability)).resolves.toBe(await fingerprintReliabilityContent({ ...reliability, expectedRevision: 9 }))

    const scoring = { displayName: 'RDI', formulaFamily: 'RDI-2.0', timeUnit: 'second', totalRdiEnabled: true, levelEnabled: false, expectedRevision: 1, weights: { RES: .2, EACS: .2, DDS: .2, GDS: .2, SLS: .2 }, eacAggregation: 'available_case_mean', eacsAggregation: 'available_case_mean', riskAnchorPolicy: 'earliest_key_risk', missingMetricPolicy: 'strict_complete_case', slsMapping: { stopLoss: 100, giveUp: 80, continue: 30, notTriggered: null, timeoutUnanswered: null } }
    await expect(fingerprintScoringDefinitionContent(scoring)).resolves.toBe(await fingerprintScoringDefinitionContent({ ...scoring, expectedRevision: 9 }))
    await expect(fingerprintScoringDefinitionContent(scoring)).resolves.toBe(await fingerprintScoringDefinitionContent({
      ...scoring, createdByAdminUserId: 'admin-1', updatedByAdminUserId: 'admin-2', publishedByAdminUserId: 'admin-3', validationReport: { errors: [] },
    }))
  })

  it('accepts a complete anonymous expert panel and warns for name-like code', () => {
    const result = validateExpertBenchmarkDocument({
      displayName: '专家基准 v1',
      expectedRevision: 1,
      ratedAt: '2026-08-04T00:00:00.000Z',
      candidatePolicies: policies,
      experts: [...experts, {
        expertCode: 'li-ming', scores: { A: 50, B: 86, C: 60, D: 83, E: 71 },
      }],
    })

    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EXPERT_CODE_REQUIRES_REVIEW' }),
    ]))
  })

  it.each(['name@example.com', '13800138000', 'wxid_secret', '专家-01', 'expert 01'])(
    'rejects identifying or illegal expert code %s',
    (expertCode) => {
      const result = validateExpertBenchmarkDocument({
        displayName: '专家基准 v1', expectedRevision: 1,
        ratedAt: '2026-08-04T00:00:00.000Z', candidatePolicies: policies,
        experts: [{ expertCode, scores: { A: 0, B: 100, C: 61, D: 84, E: 70 } }, ...experts],
      })
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'EXPERT_CODE_INVALID' }),
      ]))
    },
  )

  it('requires complete norm parameters, strict reliability and the fixed scoring schema', () => {
    expect(validateNormDocument({
      displayName: '样本常模', expectedRevision: 1, scoringVersion: 'rdi-v2', sampleSize: 2,
      populationNote: '预实验样本', metrics: {
        RES: { mean: 1, sd: 1 }, EACS: { mean: 1, sd: 1 }, DDS: { mean: 1, sd: 1 },
        GDS: { mean: 1, sd: 1 }, SLS: { mean: 1, sd: 1 },
      },
    }).errors).toEqual([])
    expect(validateReliabilityDocument({
      displayName: 'EAC 信度', expectedRevision: 1, scoringVersion: 'rdi-v2',
      sampleSize: 2, populationNote: '预实验样本', metricCode: 'EAC', sdValue: 10, reliabilityValue: 0.8,
    }).errors).toEqual([])
    expect(validateReliabilityDocument({
      displayName: 'EAC 信度', expectedRevision: 1, scoringVersion: 'rdi-v2',
      sampleSize: 2, populationNote: '预实验样本', metricCode: 'EAC', sdValue: 10, reliabilityValue: 0,
    }).errors).not.toEqual([])
    expect(validateScoringDefinitionDocument({
      displayName: 'RDI 2.0', expectedRevision: 1, formulaFamily: 'RDI-2.0', timeUnit: 'second',
      totalRdiEnabled: true, levelEnabled: false,
      weights: { RES: 0.35, EACS: 0.35, DDS: 0.15, GDS: 0.1, SLS: 0.05 },
      missingPolicy: 'strict_complete_case', eacAggregation: 'available_case',
      eacsAggregation: 'available_case', riskAnchor: 'earliest_key_risk',
      slsMapping: { stopLoss: 100, giveUp: 80, continue: 30 },
    }).errors).toEqual([])
  })

  it('rejects unknown norm metrics and unknown scoring weights in the shared validators', () => {
    const norm = validateNormDocument({
      displayName: 'Norm', expectedRevision: 1, scoringVersion: 'rdi-v2', sampleSize: 2, populationNote: 'Cohort',
      metrics: {
        RES: { mean: 1, sd: 1 }, EACS: { mean: 1, sd: 1 }, DDS: { mean: 1, sd: 1 }, GDS: { mean: 1, sd: 1 }, SLS: { mean: 1, sd: 1 }, OTHER: { mean: 1, sd: 1 },
      },
    })
    expect(norm.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NORM_METRIC_UNKNOWN' })]))

    const scoring = validateScoringDefinitionDocument({
      displayName: 'RDI', expectedRevision: 1, formulaFamily: 'RDI-2.0', timeUnit: 'second', totalRdiEnabled: true, levelEnabled: false,
      weights: { RES: 0.2, EACS: 0.2, DDS: 0.2, GDS: 0.2, SLS: 0.2, OTHER: 0 },
      missingPolicy: 'strict_complete_case', eacAggregation: 'available_case', eacsAggregation: 'available_case', riskAnchor: 'earliest_key_risk',
      slsMapping: { stopLoss: 100, giveUp: 80, continue: 30 },
    })
    expect(scoring.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WEIGHTS_UNKNOWN' })]))
  })
})
