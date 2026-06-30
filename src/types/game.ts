export type RatingStage = 'T1' | 'T2' | 'T3'
export type VerifyType = 'shallow' | 'deep'
export type PressureStage = 'green' | 'orange' | 'red'
export type SunkCostChoice = 'continue' | 'stop_loss' | 'give_up' | null
export type GamePhase = 'start' | 'playing' | 'decision' | 'report'
export type GameMode = 'formal' | 'quick'

export type Evidence = {
  title: string
  content: string
  isNegative: boolean
}

export type Candidate = {
  id: string
  name: string
  role: string
  school: string
  visibleHalo: string[]
  resumeSummary: string
  shallowEvidence: Evidence
  deepEvidence: Evidence
  trueAbility: number
  trueFit: number
  isToxic: boolean
  riskFlags: string[]
  tags: string[]
}

export type RatingRecord = {
  value: number
  elapsedSec: number
}

export type CandidateRuntimeState = {
  candidateId: string
  ratings: Partial<Record<RatingStage, RatingRecord>>
  spentPoints: number
  shallowCount: number
  deepCount: number
  shallowUnlocked: boolean
  deepUnlocked: boolean
  negativeEvidenceSeen: boolean
  addedAfterNegative: boolean
  viewTimeMs: number
}

export type GameLogType =
  | 'view'
  | 'rate'
  | 'verify'
  | 'chat'
  | 'sunk_cost'
  | 'final_select'
  | 'phase'

export type GameLog = {
  id: string
  timeLeftSec: number
  elapsedSec: number
  pressureStage: PressureStage
  responseTimeSec: number
  type: GameLogType
  candidateId?: string
  verifyType?: VerifyType
  detail: string
  pointsSpent?: number
  negativeEvidenceSeen?: boolean
  addedAfterNegative?: boolean
}

export type ChatMessage = {
  id: string
  sender: '小张' | '李姐' | '王总' | '系统'
  content: string
  elapsedSec: number
  tone: 'neutral' | 'warning' | 'urgent'
}

export type GameState = {
  phase: GamePhase
  mode: GameMode
  durationSec: number
  timeLeftSec: number
  elapsedSec: number
  availablePoints: number
  selectedCandidateId: string
  runtime: Record<string, CandidateRuntimeState>
  logs: GameLog[]
  chats: ChatMessage[]
  sunkCostChoice: SunkCostChoice
  sunkCostShown: boolean
  finalCandidateId: string | null
  activeViewStartedAtMs: number
  lastActionElapsedSec: number
  notice: string | null
}

export type ROIResult = {
  value: number
  note: string
  unverifiedHire: boolean
}

export type RevisionResult = {
  value: number
  fromStage: RatingStage
  toStage: RatingStage
  delta: number
  elapsedSec: number
} | null

export type AttentionResult = {
  failed: boolean
  candidateIds: string[]
  explanation: string
}

export type StrategyType = '目标导向型' | '习惯性捷径型'

export type RDIInput = {
  selectedAbility: number
  selectedFit: number
  attentionFailed: boolean
  strategy: StrategyType
  lossChoice: SunkCostChoice
  revisionQuality: number
}

export type RDIResult = {
  score: number
  level: '高韧性' | '中间型' | '脆弱型'
  explanation: string
  rawData: RDIInput
}

export type ReportData = {
  generatedAt: string
  mode: GameMode
  selectedCandidate: Candidate
  selectedRuntime: CandidateRuntimeState
  roi: ROIResult
  revisions: Array<{
    candidate: Candidate
    result: RevisionResult
  }>
  attention: AttentionResult
  strategy: StrategyType
  strategyExplanation: string
  lossAversion: string
  rdi: RDIResult
  logs: GameLog[]
  runtime: Record<string, CandidateRuntimeState>
  sunkCostChoice: SunkCostChoice
}
