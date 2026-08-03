import type { FormalFinalDecision, FormalGameSnapshot, FormalSunkCostSnapshot, PreGameResumeState } from './formalGame'

export type RatingStage = 'T1' | 'T2' | 'T3'
export type VerifyType = 'shallow' | 'deep'
export type PressureStage = 'green' | 'orange' | 'red'
export type SunkCostChoice = 'continue' | 'stop_loss' | 'give_up' | null
export type GamePhase = 'start' | 'playing' | 'decision' | 'report'
export type GameMode = 'formal' | 'quick'
export type FormalSessionStep =
  | 'consent_pending'
  | 'demographics'
  | 'pre_task'
  | 'game_ready'
  | 'playing'
  | 'post_task'
  | 'task_experience'
  | 'completion_pending'
  | 'completed'
export type PublicCandidateId = 'A' | 'B' | 'C' | 'D' | 'E'
export type CandidateDisplayOrder = [
  PublicCandidateId,
  PublicCandidateId,
  PublicCandidateId,
  PublicCandidateId,
  PublicCandidateId,
]
export type EvidencePolarity = 'positive' | 'negative'
export type RatingDirection = 'higher' | 'lower'
export type NikoMood = 'happy' | 'angry'
export type ResearchStep =
  | 'consent'
  | 'identity'
  | 'demographics'
  | 'preTask'
  | 'postTask'
  | 'taskExperience'
  | 'completionPending'
  | 'completion'

export type FormalIdentityInput = {
  fullName?: string | null
  studentId?: string | null
  phone?: string | null
}

export type FormalSessionVersions = {
  task: string
  material: string
  pointRule: string
  sunkCostRule: string
  scoring: string
  benchmark: string
  norm: string | null
}

export type FormalSessionContext = {
  participantId: string
  sessionId: string
  configSetId: string
  versions: FormalSessionVersions
  candidateDisplayOrder: CandidateDisplayOrder
  initialOpenedCandidate: PublicCandidateId
  currentStep: FormalSessionStep
  createdAt: string
}

export type CreateFormalSessionRequest = {
  mode: 'formal'
  identity: FormalIdentityInput
  clientVersion: string
}

export type CreateFormalSessionResponse = FormalSessionContext & {
  created: boolean
  mode: 'formal'
}

export type FormalConsentResponse = {
  created: boolean
  sessionId: string
  currentStep: 'demographics'
  consent: {
    accepted: true
    version: string
    acceptedAt: string
  }
}

export type FormalDemographicsResponse = {
  created: boolean
  sessionId: string
  currentStep: 'pre_task'
  revisionNo: number
  demographics: DemographicData
  submittedAt: string
}

export type FormalPreTaskResponse = {
  created: boolean
  sessionId: string
  currentStep: 'game_ready'
  submissionId: string
  itemCount: 5
}

export type FormalPostTaskResponse = {
  created: boolean
  sessionId: string
  currentStep: 'task_experience'
  submissionId: string
  itemCount: 5
  sequenceNo: number
}

export type FormalTaskExperienceResponse = {
  created: boolean
  sessionId: string
  currentStep: 'completion_pending'
  submissionId: string
  itemCount: 15
  sequenceNo: number
}

export type FormalCompletionResponse = {
  created: boolean
  alreadyCompleted: boolean
  sessionId: string
  currentStep: 'completed'
  completionStatus: 'completed' | 'timeout'
  finalSubmitMode: 'active' | 'timeout'
  serverCompletedAt: string
  sequenceNo: number
}

export type FormalQuestionnaireResumeSummary =
  | { saved: false }
  | {
      saved: true
      instrumentVersion: string
      itemCount: number
      sequenceNo: number
      serverSubmittedAt: string
    }

export type FormalCompletionResumeSummary =
  | { completed: false }
  | {
      completed: true
      completionStatus: 'completed' | 'timeout'
      finalSubmitMode: 'active' | 'timeout'
      serverCompletedAt: string
      sequenceNo: number
    }

export type FormalResumeData = {
  session: FormalSessionContext & { mode: 'formal' }
  consent: {
    accepted: true
    version: string
    acceptedAt: string
  } | null
  demographics: {
    revisionNo: number
    demographics: DemographicData
    submittedAt: string
  } | null
  preTask: {
    instrumentVersion: string
    startedAt: string
    submittedAt: string
    answers: Array<{
      itemId: StateAssessmentId
      value: number
      touched: true
      answeredAt: string
    }>
  } | null
  game: PreGameResumeState | FormalGameSnapshot
  sunkCost?: FormalSunkCostSnapshot | null
  finalDecision?: FormalFinalDecision | null
  postTask?: FormalQuestionnaireResumeSummary
  taskExperience?: FormalQuestionnaireResumeSummary
  completion?: FormalCompletionResumeSummary
}

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

export type PublicCandidateProfile = {
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
  tags: string[]
}

export type Candidate = PublicCandidateProfile & {
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
  version?: string
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

export type StateAssessmentData = Record<StateAssessmentId, number>

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

export type TaskExperienceData = Record<TaskExperienceId, number>

export type ResearchData = {
  participantId: string
  formalSession: FormalSessionContext | null
  consent: ConsentRecord
  demographics: DemographicData | null
  preTask: StateAssessmentData | null
  postTask: StateAssessmentData | null
  taskExperience: TaskExperienceData | null
  startedAt: string
  completedAt: string | null
}

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
  participantId: string | null
  researchData: ResearchData | null
  nikoMessages: NikoMessage[]
}
