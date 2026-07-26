import { describe, expect, it } from 'vitest'
import { candidates } from './candidates'

describe('AI assessment product assistant candidate framework', () => {
  it('contains the five fixed candidate IDs with the approved baseline order', () => {
    expect(candidates.map((candidate) => candidate.id).sort()).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ])
    expect(
      candidates
        .slice()
        .sort((left, right) => right.baselineFitScore - left.baselineFitScore)
        .map((candidate) => `${candidate.id}:${candidate.baselineFitScore}`),
    ).toEqual(['B:86', 'D:83', 'E:70', 'C:60', 'A:51'])
  })

  it('provides two source materials for each T2 and T3 evidence packet', () => {
    for (const candidate of candidates) {
      expect(candidate.role).toBe('AI测评产品助理（实习生）')
      expect(candidate.shallowEvidence).toHaveLength(2)
      expect(candidate.deepEvidence).toHaveLength(2)
      expect(candidate.expectedScoreRanges.T1).toHaveLength(2)
      expect(candidate.expectedScoreRanges.T2).toHaveLength(2)
      expect(candidate.expectedScoreRanges.T3).toHaveLength(2)
    }
  })

  it('uses the appendix six-dimension values to match every approved score', () => {
    expect(
      candidates.map((candidate) => [
        candidate.id,
        candidate.dimensionScores,
        candidate.baselineFitScore,
      ]),
    ).toEqual([
      ['A', { dataAnalysis: 4, userResearch: 2, productExecution: 2, reportExpression: 3, toolApplication: 2, authenticity: 1 }, 51],
      ['B', { dataAnalysis: 4, userResearch: 5, productExecution: 4, reportExpression: 5, toolApplication: 3, authenticity: 5 }, 86],
      ['C', { dataAnalysis: 3, userResearch: 2, productExecution: 4, reportExpression: 4, toolApplication: 3, authenticity: 2 }, 60],
      ['D', { dataAnalysis: 5, userResearch: 3, productExecution: 4, reportExpression: 4, toolApplication: 4, authenticity: 5 }, 83],
      ['E', { dataAnalysis: 3, userResearch: 3, productExecution: 4, reportExpression: 4, toolApplication: 3, authenticity: 5 }, 70],
    ])
  })
})
