export type PasswordAdminSessionData = {
  authenticated: true
  authMode?: 'password'
  admin: { username: string }
  session: {
    createdAt: string
    lastSeenAt: string
    idleExpiresAt: string
    absoluteExpiresAt: string
  }
}

export type PublicAdminSessionData = {
  authenticated: true
  authMode: 'public'
  username: 'public-admin'
}

export type AdminSessionData = PasswordAdminSessionData | PublicAdminSessionData

export type AdminLoginData = {
  authenticated: true
  admin: { username: string }
  session: {
    createdAt: string
    absoluteExpiresAt: string
    idleTimeoutSec: number
  }
  authPolicyVersion: string
}

export type AdminAuditItem = {
  auditId: string
  action: string
  outcome: 'success' | 'failure' | 'blocked'
  targetType: string | null
  targetId: string | null
  requestId: string
  createdAt: string
  metadata: Record<string, string | number | boolean | null>
}

export type AdminAuditPage = {
  items: AdminAuditItem[]
  nextCursor: string | null
}

export type AdminResearchSession = {
  sessionId: string
  participantId: string
  identity: { name: string | null; studentId: string | null; phone: string | null }
  status: string
  currentStep: string
  startedAt: string | null
  endedAt: string | null
  completionType: string
  taskVersion: string
  materialVersion: string
  configVersion: string
  qualityFlags: string[]
}

export type AdminResearchPage = { items: AdminResearchSession[]; nextCursor: string | null }

export type AdminFormalAssessmentReport = {
  sessionSummary: { sessionId: string; status: string; currentStep: string; startedAt: string | null; completedAt: string | null; completionType: string | null }
  versions: { config: string; task: string; material: string; pointRule: string; sunkCostRule: string; scoring: string; benchmark: string; norm: string | null; reliability: string | null }
  stageChoices: { t1: AdminReportChoice | null; t2: AdminReportChoice | null; t3: AdminReportChoice | null }
  finalDecision: AdminReportFinalDecision | null
  stageRatings: AdminReportRating[]
  evidenceSummary: { sequence: AdminReportEvidence[]; pointLedger: AdminReportPointLedger[] }
  pointSummary: { totalPoints: number; remainingPoints: number; usedPoints: number; shallowCount: number; deepCount: number } | null
  sunkCostSummary: { targetCandidateId: string | null; triggerReason: string; shownAt: string | null; choice: string | null; choiceSubmittedAt: string | null; pointsInvestedBefore: number; choiceStatus: string } | null
  derivedMetrics: AdminReportMetric[]
  candidateSummaries: Array<{ candidateId: string; name: string; role: string; benchmarkValue: number | null }>
}

export type AdminReportChoice = { candidateId: string; confidence: number; submittedAt: string }
export type AdminReportFinalDecision = { candidateId: string; confidence: number; submitMode: string; sourceStage: string; submittedAt: string; [key: string]: unknown }
export type AdminReportRating = { candidateId: string; stage: string; ratingValue: number; submittedAt: string; sequenceNo: number }
export type AdminReportEvidence = { candidateId: string; evidenceLevel: string; pointsBefore: number; pointsCost: number; pointsAfter: number; containsKeyRisk: number; unlockedAt: string; sequenceNo: number }
export type AdminReportPointLedger = { candidateId: string | null; evidenceLevel: string | null; pointsBefore: number; pointsDelta: number; pointsAfter: number; sequenceNo: number; createdAt: string }
export type AdminReportMetric = { metricCode: string; numericValue: number | null; calculationStatus: string; missingReason: string | null; computedAt: string }

export type ConfigStatus = 'draft' | 'published' | 'retired'
export type ValidationStatus = 'not_validated' | 'valid' | 'invalid' | 'stale'
export type ConfigurationIssue = { code: string; path: string; message: string }

export type AdminMaterialProfile = {
  candidateId: string
  displayOrder: number
  name: string
  role: string
  school: string
  visibleHalo: string[]
  resumeSummary: string
  education: string
  skills: string[]
  experiences: Array<{ title: string; content: string }>
  initialImage: string
  publicTags: string[]
}

export type AdminMaterialEvidence = {
  evidenceId: string
  candidateId: string
  level: 'shallow' | 'deep'
  order: number
  title: string
  content: string
  polarity: 'positive' | 'negative'
  isKeyRisk: boolean
}

export type AdminMaterialDetail = {
  version: string
  displayName: string
  status: ConfigStatus
  sourceVersion: string | null
  revision: number
  validationStatus: ValidationStatus
  validationReport: { errors: ConfigurationIssue[]; warnings: ConfigurationIssue[] }
  fingerprint: string | null
  publishedAt: string | null
  profiles: AdminMaterialProfile[]
  evidence: AdminMaterialEvidence[]
}

export type AdminRuleDetail = {
  version: string
  displayName: string
  status: ConfigStatus
  sourceVersion: string | null
  revision: number
  validationStatus: ValidationStatus
  validationReport: { errors: ConfigurationIssue[]; warnings: ConfigurationIssue[] }
  fingerprint: string | null
  publishedAt: string | null
  rule: Record<string, number | boolean>
}

export type AdminConfigurationDetail = {
  configSetId: string
  displayName: string
  sourceConfigSetId: string | null
  status: ConfigStatus
  active: boolean
  revision: number
  validationStatus: ValidationStatus
  validationReport: { errors: ConfigurationIssue[]; warnings: ConfigurationIssue[] }
  fingerprint: string | null
  taskVersion: string
  materialVersion: string
  pointRuleVersion: string
  sunkCostRuleVersion: string
  scoringVersion: string
  benchmarkVersion: string
  normVersion: null
  publishedAt: string | null
  activatedAt: string | null
}
