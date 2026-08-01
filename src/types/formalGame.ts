import type { CandidateDisplayOrder, PublicCandidateId } from './game'

export type FormalGameStage = 'T1' | 'T1_COMPLETE'

export type FormalT1Rating = {
  candidateId: PublicCandidateId
  stage: 'T1'
  ratingValue: number
  sealed: true
  sequenceNo: number
  serverSubmittedAt: string
}

export type FormalT1StageChoice = {
  stage: 'T1'
  candidateId: PublicCandidateId
  confidence: number
  sealed: true
  sequenceNo: number
  serverSubmittedAt: string
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
  points: { total: 5; remaining: 5 }
  ratings: FormalT1Rating[]
  stageChoice: FormalT1StageChoice | null
  lastSequenceNo?: number
}

export type FormalGameStartResponse = Omit<FormalGameSnapshot, 'started' | 'resumeSupported'> & {
  created: boolean
  sessionId: string
  currentStep: 'playing'
  candidateDisplayOrder: CandidateDisplayOrder
  initialOpenedCandidate: PublicCandidateId
}

export type FormalT1RatingResponse = FormalT1Rating & {
  created: boolean
  sessionId: string
  ratedCandidateCount: number
  requiredCandidateCount: 5
  allT1Rated: boolean
}

export type FormalT1StageChoiceResponse = FormalT1StageChoice & {
  created: boolean
  sessionId: string
  currentStage: 'T1_COMPLETE'
}

export type PreGameResumeState = {
  startedAt: null
  deadlineAt: null
  resumeSupported: false
}
