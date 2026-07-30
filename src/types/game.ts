export type RatingStage = 'T1' | 'T2' | 'T3'
export type VerifyType = 'shallow' | 'deep'
export type PressureStage = 'green' | 'orange' | 'red'
export type SunkCostChoice = 'continue' | 'stop_loss' | 'give_up' | null
export type GamePhase = 'start' | 'playing' | 'decision' | 'report'
export type GameMode = 'formal' | 'quick'
export type SessionStatus =
  | 'in_progress'
  | 'completed'
  | 'abandoned'
  | 'technical_error'
export type SubmissionType = 'manual' | 'timeout_confirmed' | 'timeout_auto'
export type PersistedStage = RatingStage | 'FINAL'
export type EvidencePolarity = 'positive' | 'negative'
export type RatingDirection = 'higher' | 'lower'
export type NikoMood = 'happy' | 'angry'
export type ResearchStep =
  | 'consent'
  | 'demographics'
  | 'preTask'
  | 'postTask'
  | 'taskExperience'
  | 'report'

export type Evidence = {
  id: string
  title: string
  content: string
  isNegative: boolean
  polarity: EvidencePolarity
}

export type CandidateDimensionId =
  | 'dataAnalysis'
  | 'userResearch'
  | 'productExecution'
  | 'reportExpression'
  | 'toolApplication'
  | 'authenticity'

export type CandidateDimensionScores = Record<
  CandidateDimensionId,
  number
>

export type CandidateExperience = {
  title: string
  content: string
}

export type ExpectedScoreRanges = Record<RatingStage, [number, number]>
export type ExpectedEvidenceUpdate = 'up' | 'down' | 'stable'

export type Candidate = {
  id: string
  name: string
  role: string
  school: string
  visibleHalo: string[]
  resumeSummary: string
  education: string
  skills: string[]
  experiences: CandidateExperience[]
  initialImage: string
  trueStrengths: string
  mainShortcomings: string
  shallowEvidence: Evidence[]
  deepEvidence: Evidence[]
  dimensionScores: CandidateDimensionScores
  baselineFitScore: number
  expectedScoreRanges: ExpectedScoreRanges
  expectedUpdate: ExpectedEvidenceUpdate
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
  viewedEvidenceIds: string[]
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

export type NikoMessage = {
  id: string
  candidateId: string
  stage: 'T2' | 'T3'
  mood: NikoMood
  text: string
  relatedEvidenceId: string
  timestamp: number
}

export type ConsentRecord = {
  accepted: boolean
  acceptedAt: string | null
}

export type DemographicData = {
  ageRange: '18–20' | '21–23' | '24及以上' | '不愿透露'
  gender: '男' | '女' | '其他' | '不愿透露'
  education: '本科' | '硕士' | '其他' | '不愿透露'
  grade: '大一' | '大二' | '大三' | '大四' | '研究生' | '不愿透露'
  majorCategory:
    | '心理学'
    | '计算机或人工智能'
    | '经管'
    | '理工科'
    | '人文社科'
    | '其他'
    | '不愿透露'
  relatedExperience: Array<
    | '企业实习经历'
    | '学生科研经历'
    | '数据分析相关经历'
    | '招聘或人才评估相关经历'
    | '无相关经历'
  >
}

export type StateAssessmentId =
  | 'stress'
  | 'fatigue'
  | 'attention'
  | 'mood'
  | 'physicalDiscomfort'

export type StateAssessmentData = Record<StateAssessmentId, number | null>

export type TaskExperienceId =
  | 'timePressure1'
  | 'timePressure2'
  | 'resourceLimit1'
  | 'resourceLimit2'
  | 'socialEvaluation1'
  | 'socialEvaluation2'
  | 'outcomeResponsibility1'
  | 'outcomeResponsibility2'
  | 'uncontrollability1'
  | 'uncontrollability2'
  | 'cognitiveLoad1'
  | 'cognitiveLoad2'
  | 'cognitiveLoad3'
  | 'cognitiveLoad4'
  | 'decisionConfidence'

export type TaskExperienceData = Record<TaskExperienceId, number | null>

export type ResearchData = {
  participantId: string
  consent: ConsentRecord
  demographics: DemographicData | null
  preTask: StateAssessmentData | null
  postTask: StateAssessmentData | null
  taskExperience: TaskExperienceData | null
  startedAt: string
  completedAt: string | null
}

export type StageSnapshot = {
  eventId: string
  sessionId: string
  stage: PersistedStage
  preferredCandidateId: string | null
  confidence: number | null
  submittedAt: string
}

export type RatingEvent = {
  eventId: string
  sessionId: string
  candidateId: string
  stage: RatingStage
  score: number
  relatedEvidenceIds: string[]
  submittedAt: string
  elapsedSec: number
}

export type EvidenceEvent = {
  eventId: string
  sessionId: string
  candidateId: string
  evidenceId: string
  verifyType: VerifyType
  evidencePolarity: EvidencePolarity
  viewedAt: string
  elapsedSec: number
  pointsBefore: number
  pointsCost: number
  pointsAfter: number
  riskEvidenceSeenBefore: boolean
  addedAfterRiskEvidence: boolean
  cumulativeAddedAfterRiskEvidence: number
  additionalPointsThisEvent: number
  cumulativeAdditionalPointsAfterRisk: number
  riskEvidenceIdsPreviouslySeen: string[]
}

export type SunkCostEvent = {
  eventId: string
  sessionId: string
  choice: Exclude<SunkCostChoice, null>
  selectedAt: string
  elapsedSec: number
  pointsSpentBeforeChoice: number
  availablePointsBeforeChoice: number
  preferredCandidateIdAtChoice: string | null
  confidenceAtChoice: number | null
  toxicCandidateId: string | null
  toxicCandidatePoints: number
  subsequentAdditionalPoints: number
  subsequentCandidateSwitches: number
  subsequentRatingChanges: number
  finalCandidateId: string | null
  finalConfidence: number | null
  secondsFromChoiceToFinal: number | null
}

export type FinalDecision = {
  eventId: string
  sessionId: string
  candidateId: string | null
  confidence: number | null
  submissionType: SubmissionType
  submittedAt: string
  elapsedSec: number
  currentStage: PersistedStage
  timeoutSource: 'timer' | null
}

export type ClientError = {
  errorId: string
  sessionId: string | null
  errorType: 'window_error' | 'unhandled_rejection' | 'react_boundary' | 'api' | 'restore' | 'resource'
  message: string
  stack: string | null
  route: string
  occurredAt: string
  appVersion: string
  fatal: boolean
  affectedAssessment: boolean
}

export type PendingUpload = {
  eventId: string
  kind: 'event_batch' | 'stage_snapshot' | 'session_patch' | 'completion' | 'client_error'
  payload: unknown
  queuedAt: string
  attempts: number
}

type PersistedSessionBase = {
  schemaVersion: number
  appVersion: string
  sessionId: string
  status: SessionStatus
  startedAt: string
  updatedAt: string
  lastHeartbeatAt: string
  completedAt: string | null
  submissionTrigger: SubmissionType | null
  invalidForAssessment: boolean
  invalidReason: string | null
  gameState: GameState | null
}

export type FormalPersistedSession = PersistedSessionBase & {
  mode: 'formal'
  participantId: string
  researchData: ResearchData
  stageSnapshots: StageSnapshot[]
  ratingEvents: RatingEvent[]
  evidenceEvents: EvidenceEvent[]
  sunkCostEvents: SunkCostEvent[]
  finalDecision: FinalDecision | null
  clientErrors: ClientError[]
  pendingUploads: PendingUpload[]
}

export type QuickPersistedSession = PersistedSessionBase & {
  mode: 'quick'
  trainingEvents: GameLog[]
}

export type PersistedSession = FormalPersistedSession | QuickPersistedSession

export type GameState = {
  phase: GamePhase
  mode: GameMode
  durationSec: number
  timeLeftSec: number
  elapsedSec: number
  availablePoints: number
  candidateDisplayOrder: string[]
  selectedCandidateId: string
  runtime: Record<string, CandidateRuntimeState>
  logs: GameLog[]
  chats: ChatMessage[]
  nikoMessages: NikoMessage[]
  sunkCostChoice: SunkCostChoice
  sunkCostShown: boolean
  finalCandidateId: string | null
  activeViewStartedAtMs: number
  lastActionElapsedSec: number
  notice: string | null
  participantId: string | null
  researchData: ResearchData | null
  sessionId: string
  stageSnapshots: StageSnapshot[]
  ratingEvents: RatingEvent[]
  evidenceEvents: EvidenceEvent[]
  sunkCostEvents: SunkCostEvent[]
  finalDecision: FinalDecision | null
  pendingSnapshotStage: RatingStage | null
  invalidForAssessment: boolean
  invalidReason: string | null
  technicalPauseStartedAt: string | null
  technicalPauseMs: number
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
  level: '高韧性' | '中间型' | '脆弱型' | '技术无效'
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
  participantId: string | null
  researchData: ResearchData | null
  nikoMessages: NikoMessage[]
  invalidForAssessment: boolean
  invalidReason: string | null
}
