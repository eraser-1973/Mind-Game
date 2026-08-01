import type { CandidateDisplayOrder, PublicCandidateId } from './game'

export type FormalRatingStage = 'T1' | 'T2' | 'T3'
export type FormalEvidenceLevel = 'shallow' | 'deep'
export type FormalGameStage = 'T1' | 'T1_COMPLETE' | 'T2' | 'T3' | 'DECISION'
export type FormalStageStatus =
  | 'T1_ACTIVE'
  | 'T1_COMPLETE'
  | 'T2_ACTIVE'
  | 'T2_COMPLETE'
  | 'T3_ACTIVE'
  | 'T3_COMPLETE'
  | 'DECISION_COMPLETE'

export type FormalSunkCostChoice = 'continue' | 'stop_loss' | 'give_up' | 'not_triggered' | null

export type FormalSunkCostSnapshot = {
  created: boolean
  triggered: boolean
  required: boolean
  sunkEventId?: string
  targetCandidateId?: PublicCandidateId | null
  pointsInvestedBefore?: number
  shownAt?: string | null
  choice?: FormalSunkCostChoice
  choiceSubmittedAt?: string | null
  pointsAfterChoice?: number | null
}

export type FormalFinalDecision = {
  created: boolean
  finalDecisionId: string
  candidateId: PublicCandidateId
  confidence: number
  submitMode: 'active' | 'timeout'
  sourceStage: FormalRatingStage
  selectionOrigin: 'active_user' | 'timeout_latest_sealed_choice'
  autoSelected: boolean
  serverSubmittedAt: string
  sequenceNo: number
  remainingSec: number
  pointsRemaining: number
  currentStep: 'post_task'
}

export type FormalRating = {
  candidateId: PublicCandidateId
  stage: FormalRatingStage
  ratingValue: number
  evidenceIdsSeen: string[]
  sealed: true
  sequenceNo: number
  serverSubmittedAt: string
}

export type FormalStageChoice = {
  stage: FormalRatingStage
  candidateId: PublicCandidateId
  confidence: number
  sealed: true
  sequenceNo: number
  serverSubmittedAt: string
}

export type FormalEvidenceItem = {
  id: string
  title: string
  content: string
  polarity: 'positive' | 'negative'
  order: number
}

export type FormalEvidenceUnlock = {
  candidateId: PublicCandidateId
  level: FormalEvidenceLevel
  ratingStage: 'T2' | 'T3'
  sequenceNo: number
  serverAt: string
  points: { before: number; cost: number; after: number }
  evidence: FormalEvidenceItem[]
}

export type FormalGameSnapshot = {
  started: true
  resumeSupported: true
  durationSec: 900
  startedAt: string
  deadlineAt: string
  serverNow: string
  remainingSec: number
  expired: boolean
  currentStage: FormalGameStage
  stageStatus: FormalStageStatus
  points: { total: number; remaining: number }
  ratings: FormalRating[]
  stageChoice: FormalStageChoice | null
  stageChoices: FormalStageChoice[]
  evidenceUnlocks: FormalEvidenceUnlock[]
  lastSequenceNo?: number
  sunkCost?: FormalSunkCostSnapshot | null
  finalDecision?: FormalFinalDecision | null
}

export type FormalGameStartResponse = Omit<FormalGameSnapshot, 'started' | 'resumeSupported' | 'lastSequenceNo'> & {
  created: boolean
  sessionId: string
  currentStep: 'playing'
  candidateDisplayOrder: CandidateDisplayOrder
  initialOpenedCandidate: PublicCandidateId
}

export type FormalRatingResponse = FormalRating & {
  created: boolean
  sessionId: string
  ratedCandidateCount: number
  requiredCandidateCount: number
  allStageRated: boolean
  allT1Rated: boolean
}

export type FormalStageChoiceResponse = FormalStageChoice & {
  created: boolean
  sessionId: string
  currentStage: FormalGameStage
  stageStatus: FormalStageStatus
}

export type FormalEvidenceUnlockResponse = FormalEvidenceUnlock & {
  created: boolean
  alreadyUnlocked: boolean
  sessionId: string
  currentStage: FormalGameStage
  stageStatus: FormalStageStatus
  points: { before: number; cost: number; after: number; total: number }
}

export type FormalT1Rating = FormalRating & { stage: 'T1' }
export type FormalT1StageChoice = FormalStageChoice & { stage: 'T1' }
export type FormalT1RatingResponse = FormalRatingResponse & { stage: 'T1' }
export type FormalT1StageChoiceResponse = FormalStageChoiceResponse & {
  stage: 'T1'
  currentStage: 'T1_COMPLETE'
  stageStatus: 'T1_COMPLETE'
}

export type PreGameResumeState = {
  startedAt: null
  deadlineAt: null
  resumeSupported: false
}
