import { describe, expect, it } from 'vitest'
import {
  buildSunkCostSnapshot,
  calculatePointsAfterChoice,
  calculateSunkCostEligibility,
  chooseSunkCostTarget,
} from '../worker/domain/sunkCost'
import { deriveFinalDecisionEligibility } from '../worker/domain/finalDecisionEligibility'

const order = ['B', 'A', 'C', 'D', 'E'] as const

describe('sunk cost domain rules', () => {
  it('requires the server time window, key risk, and minimum candidate investment', () => {
    const eligibleCandidate = {
      candidateId: 'A' as const,
      pointsInvested: 2,
      firstKeyRiskSequence: 7,
      riskEvidenceIdsSeen: ['A-t2-1'],
    }
    expect(calculateSunkCostEligibility({
      remainingSec: 301,
      triggerRemainingSec: 300,
      minimumCandidateInvestment: 2,
      requiresKeyRisk: true,
      candidates: [eligibleCandidate],
      alreadyRecorded: false,
      finalSubmitted: false,
    }).eligible).toBe(false)
    expect(calculateSunkCostEligibility({
      remainingSec: 300,
      triggerRemainingSec: 300,
      minimumCandidateInvestment: 3,
      requiresKeyRisk: true,
      candidates: [eligibleCandidate],
      alreadyRecorded: false,
      finalSubmitted: false,
    }).eligible).toBe(false)
    expect(calculateSunkCostEligibility({
      remainingSec: 300,
      triggerRemainingSec: 300,
      minimumCandidateInvestment: 2,
      requiresKeyRisk: true,
      candidates: [{ ...eligibleCandidate, riskEvidenceIdsSeen: [], firstKeyRiskSequence: null }],
      alreadyRecorded: false,
      finalSubmitted: false,
    }).eligible).toBe(false)
    expect(calculateSunkCostEligibility({
      remainingSec: 300,
      triggerRemainingSec: 300,
      minimumCandidateInvestment: 2,
      requiresKeyRisk: true,
      candidates: [eligibleCandidate],
      alreadyRecorded: false,
      finalSubmitted: false,
    })).toMatchObject({ eligible: true, eligibleCandidateIds: ['A'] })
  })

  it('chooses the deterministic target by investment, risk sequence, then display order', () => {
    const candidates = [
      { candidateId: 'A' as const, pointsInvested: 3, firstKeyRiskSequence: 6, riskEvidenceIdsSeen: ['A-t2-1'] },
      { candidateId: 'B' as const, pointsInvested: 4, firstKeyRiskSequence: 9, riskEvidenceIdsSeen: ['B-risk'] },
      { candidateId: 'C' as const, pointsInvested: 4, firstKeyRiskSequence: 8, riskEvidenceIdsSeen: ['C-t2-1'] },
    ]
    expect(chooseSunkCostTarget(candidates, order)?.candidateId).toBe('C')
    const displayTie = candidates.map((item) => ({ ...item, pointsInvested: 4, firstKeyRiskSequence: 8 }))
    expect(chooseSunkCostTarget(displayTie, order)?.candidateId).toBe('B')
  })

  it('builds a public snapshot without private risk evidence identifiers', () => {
    const snapshot = buildSunkCostSnapshot({
      sunkEventId: '9ab86263-c60c-49f0-93dd-43eddf1cf96c',
      targetCandidateId: 'A',
      pointsInvestedBefore: 4,
      shownAt: '2026-08-01T00:10:00.000Z',
      showSequenceNo: 16,
      choice: null,
      choiceSubmittedAt: null,
      pointsAfterChoice: null,
      choiceStatus: 'pending',
    })
    expect(snapshot).toEqual({
      triggered: true,
      required: true,
      sunkEventId: '9ab86263-c60c-49f0-93dd-43eddf1cf96c',
      targetCandidateId: 'A',
      pointsInvestedBefore: 4,
      shownAt: '2026-08-01T00:10:00.000Z',
      choice: null,
      choiceSubmittedAt: null,
      pointsAfterChoice: null,
    })
    expect(JSON.stringify(snapshot)).not.toContain('riskEvidence')
  })

  it('counts only successful ledger costs after the choice sequence', () => {
    expect(calculatePointsAfterChoice([
      { sequenceNo: 4, pointsDelta: -1 },
      { sequenceNo: 8, pointsDelta: -3 },
      { sequenceNo: 9, pointsDelta: -1 },
    ], 8)).toBe(1)
    expect(calculatePointsAfterChoice([], 8)).toBe(0)
  })
})

describe('final decision eligibility', () => {
  it.each([
    ['T2_COMPLETE', null, true, 'T2'],
    ['T3_COMPLETE', null, true, 'T3'],
    ['T2_ACTIVE', 'give_up', true, 'T1'],
    ['T1_COMPLETE', null, false, null],
    ['T2_ACTIVE', 'continue', false, null],
  ] as const)('derives %s with choice %s', (stageStatus, sunkChoice, allowed, sourceStage) => {
    expect(deriveFinalDecisionEligibility({
      stageStatus,
      sunkChoice,
      hasT1Choice: true,
      hasT2Choice: stageStatus !== 'T1_COMPLETE' && stageStatus !== 'T2_ACTIVE',
      hasT3Choice: stageStatus === 'T3_COMPLETE',
      sunkResponsePending: false,
      finalSubmitted: false,
      completionStatus: 'in_progress',
      currentStep: 'playing',
      expired: false,
    })).toMatchObject({ allowed, sourceStage })
  })

  it('rejects missing T1, pending sunk response, expiry, or a sealed final', () => {
    const base = {
      stageStatus: 'T2_COMPLETE' as const,
      sunkChoice: null,
      hasT1Choice: true,
      hasT2Choice: true,
      hasT3Choice: false,
      sunkResponsePending: false,
      finalSubmitted: false,
      completionStatus: 'in_progress',
      currentStep: 'playing',
      expired: false,
    }
    expect(deriveFinalDecisionEligibility({ ...base, hasT1Choice: false }).allowed).toBe(false)
    expect(deriveFinalDecisionEligibility({ ...base, sunkResponsePending: true }).allowed).toBe(false)
    expect(deriveFinalDecisionEligibility({ ...base, expired: true }).allowed).toBe(false)
    expect(deriveFinalDecisionEligibility({ ...base, finalSubmitted: true }).allowed).toBe(false)
  })
})
