export type AdminSessionData = {
  authenticated: true
  admin: { username: string }
  session: {
    createdAt: string
    lastSeenAt: string
    idleExpiresAt: string
    absoluteExpiresAt: string
  }
}

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
