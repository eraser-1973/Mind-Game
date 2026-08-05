import type { SunkCostChoice } from './sunkCost'

export type FinalSourceStage = 'T1' | 'T2' | 'T3'

export function deriveFinalDecisionEligibility(input: {
  stageStatus: string
  sunkChoice: SunkCostChoice | null
  hasT1Choice: boolean
  hasT2Choice: boolean
  hasT3Choice: boolean
  canFinalizeAtT2: boolean
  sunkResponsePending: boolean
  finalSubmitted: boolean
  completionStatus: string
  currentStep: string
  expired: boolean
}): { allowed: boolean; sourceStage: FinalSourceStage | null; reason: string | null } {
  if (!input.hasT1Choice) return { allowed: false, sourceStage: null, reason: 'T1_CHOICE_REQUIRED' }
  if (input.finalSubmitted) return { allowed: false, sourceStage: null, reason: 'FINAL_ALREADY_SUBMITTED' }
  if (input.completionStatus !== 'in_progress' || input.currentStep !== 'playing') {
    return { allowed: false, sourceStage: null, reason: 'GAME_NOT_PLAYING' }
  }
  if (input.expired) return { allowed: false, sourceStage: null, reason: 'GAME_EXPIRED' }
  if (input.sunkResponsePending) {
    return { allowed: false, sourceStage: null, reason: 'SUNK_COST_RESPONSE_REQUIRED' }
  }
  if (input.sunkChoice === 'give_up') {
    return {
      allowed: true,
      sourceStage: input.hasT3Choice ? 'T3' : input.hasT2Choice ? 'T2' : 'T1',
      reason: null,
    }
  }
  if (input.stageStatus === 'T3_COMPLETE' && input.hasT3Choice) {
    return { allowed: true, sourceStage: 'T3', reason: null }
  }
  if (input.stageStatus === 'T2_ACTIVE' && input.canFinalizeAtT2) {
    return { allowed: true, sourceStage: 'T2', reason: null }
  }
  if (input.stageStatus === 'T2_COMPLETE' && input.hasT2Choice) {
    return { allowed: true, sourceStage: 'T2', reason: null }
  }
  return { allowed: false, sourceStage: null, reason: 'FINAL_DECISION_NOT_AVAILABLE' }
}
