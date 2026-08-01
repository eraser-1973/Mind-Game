import type { FormalCandidateId } from '../validation/formalGameRequest'

export type SunkCostChoice = 'continue' | 'stop_loss' | 'give_up'
export type StoredSunkCostChoice = SunkCostChoice | 'not_triggered' | null
export type SunkCostChoiceStatus =
  | 'pending'
  | 'answered'
  | 'not_triggered'
  | 'timeout_unanswered'

export type SunkCostCandidateFacts = {
  candidateId: FormalCandidateId
  pointsInvested: number
  firstKeyRiskSequence: number | null
  riskEvidenceIdsSeen: string[]
}

export function calculateSunkCostEligibility(input: {
  remainingSec: number
  triggerRemainingSec: number
  minimumCandidateInvestment: number
  requiresKeyRisk: boolean
  candidates: SunkCostCandidateFacts[]
  alreadyRecorded: boolean
  finalSubmitted: boolean
}) {
  const eligibleCandidates = input.candidates.filter((candidate) =>
    candidate.pointsInvested >= input.minimumCandidateInvestment &&
    (!input.requiresKeyRisk || (
      candidate.firstKeyRiskSequence !== null &&
      candidate.riskEvidenceIdsSeen.length > 0
    )),
  )
  const eligible =
    input.remainingSec <= input.triggerRemainingSec &&
    input.remainingSec >= 0 &&
    !input.alreadyRecorded &&
    !input.finalSubmitted &&
    eligibleCandidates.length > 0
  return {
    eligible,
    eligibleCandidateIds: eligible
      ? eligibleCandidates.map(({ candidateId }) => candidateId)
      : [],
  }
}

export function chooseSunkCostTarget(
  candidates: SunkCostCandidateFacts[],
  candidateDisplayOrder: readonly FormalCandidateId[],
): SunkCostCandidateFacts | null {
  const displayIndex = new Map(candidateDisplayOrder.map((id, index) => [id, index]))
  return [...candidates].sort((left, right) =>
    right.pointsInvested - left.pointsInvested ||
    (left.firstKeyRiskSequence ?? Number.MAX_SAFE_INTEGER) -
      (right.firstKeyRiskSequence ?? Number.MAX_SAFE_INTEGER) ||
    (displayIndex.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER) -
      (displayIndex.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER),
  )[0] ?? null
}

export function buildSunkCostSnapshot(row: {
  sunkEventId: string
  targetCandidateId: FormalCandidateId | null
  pointsInvestedBefore: number
  shownAt: string | null
  showSequenceNo: number | null
  choice: StoredSunkCostChoice
  choiceSubmittedAt: string | null
  pointsAfterChoice: number | null
  choiceStatus: SunkCostChoiceStatus
}) {
  const triggered = row.shownAt !== null
  return {
    triggered,
    required: triggered && row.choiceStatus === 'pending',
    sunkEventId: row.sunkEventId,
    targetCandidateId: row.targetCandidateId,
    pointsInvestedBefore: row.pointsInvestedBefore,
    shownAt: row.shownAt,
    choice: row.choice,
    choiceSubmittedAt: row.choiceSubmittedAt,
    pointsAfterChoice: row.pointsAfterChoice,
  }
}

export function calculatePointsAfterChoice(
  ledger: Array<{ sequenceNo: number; pointsDelta: number }>,
  choiceSequenceNo: number,
): number {
  return ledger
    .filter(({ sequenceNo }) => sequenceNo > choiceSequenceNo)
    .reduce((total, { pointsDelta }) => total + Math.max(0, -pointsDelta), 0)
}
