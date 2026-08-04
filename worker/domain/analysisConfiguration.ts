export type AnalysisIssue = {
  code: string
  path: string
  message: string
}

export type AnalysisValidationResult = {
  errors: AnalysisIssue[]
  warnings: AnalysisIssue[]
}

export const analysisCandidateIds = ['A', 'B', 'C', 'D', 'E'] as const
export type AnalysisCandidateId = typeof analysisCandidateIds[number]
export const analysisMetricCodes = ['RES', 'EACS', 'DDS', 'GDS', 'SLS'] as const
export type AnalysisMetricCode = typeof analysisMetricCodes[number]

export type CandidatePolicy = {
  candidateId: AnalysisCandidateId
  direction: -1 | 0 | 1
  includeInCoreEac: boolean
}

export type ExpertBenchmarkDocument = {
  displayName: string
  expectedRevision: number
  ratedAt: string
  candidatePolicies: readonly CandidatePolicy[]
  experts: readonly {
    expertCode: string
    scores: Record<AnalysisCandidateId, number>
  }[]
}

export type NormDocument = {
  displayName: string
  expectedRevision: number
  scoringVersion: string
  sampleSize: number
  populationNote: string
  metrics: Record<AnalysisMetricCode, { mean: number; sd: number }>
}

export type ReliabilityDocument = {
  displayName: string
  expectedRevision: number
  scoringVersion: string
  sampleSize: number
  populationNote: string
  metricCode: 'EAC'
  sdValue: number
  reliabilityValue: number
}

export type ScoringDefinitionDocument = {
  displayName: string
  expectedRevision: number
  formulaFamily: 'RDI-2.0'
  timeUnit: 'second'
  totalRdiEnabled: boolean
  levelEnabled: false
  weights: Record<AnalysisMetricCode, number>
  missingPolicy: 'strict_complete_case'
  eacAggregation: 'available_case'
  eacsAggregation: 'available_case'
  riskAnchor: 'earliest_key_risk'
  slsMapping: { stopLoss: 100; giveUp: 80; continue: 30 }
}

function issue(code: string, path: string, message: string): AnalysisIssue {
  return { code, path, message }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{3,64}$/.test(value)
}

function validDate(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Expert codes are anonymous internal codes, never personal contact details. */
export function classifyExpertCode(value: unknown): {
  valid: boolean
  shouldWarn: boolean
} {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{3,64}$/.test(value)) {
    return { valid: false, shouldWarn: false }
  }
  const lower = value.toLowerCase()
  if (value.includes('@') || /^wxid[_-]/i.test(value)
    || (/^\d{11}$/.test(value))) {
    return { valid: false, shouldWarn: false }
  }
  // A two/three-token Latin name (including a common pinyin-like spelling)
  // remains technically valid, but must be reviewed by the administrator.
  const shouldWarn = /^[A-Za-z]{2,}(?:[._-][A-Za-z]{2,}){1,2}$/.test(value)
  return { valid: true, shouldWarn }
}

function validateRevision(value: unknown, path: string, errors: AnalysisIssue[]) {
  if (!Number.isInteger(value) || (value as number) < 1) {
    errors.push(issue('REVISION_INVALID', path, 'expectedRevision must be a positive integer.'))
  }
}

export function validateExpertBenchmarkDocument(value: unknown): AnalysisValidationResult {
  const errors: AnalysisIssue[] = []
  const warnings: AnalysisIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { errors: [issue('DOCUMENT_INVALID', '', 'An expert benchmark document is required.')], warnings }
  }
  const document = value as Partial<ExpertBenchmarkDocument>
  if (!validText(document.displayName)) errors.push(issue('DISPLAY_NAME_INVALID', 'displayName', 'A display name is required.'))
  validateRevision(document.expectedRevision, 'expectedRevision', errors)
  if (!validDate(document.ratedAt)) errors.push(issue('RATED_AT_INVALID', 'ratedAt', 'ratedAt must be an ISO date.'))

  if (!Array.isArray(document.candidatePolicies) || document.candidatePolicies.length !== 5) {
    errors.push(issue('POLICY_MATRIX_INVALID', 'candidatePolicies', 'Exactly five candidate policies are required.'))
  } else {
    const seen = new Set<string>()
    document.candidatePolicies.forEach((policy, index) => {
      const path = `candidatePolicies[${index}]`
      if (!analysisCandidateIds.includes(policy?.candidateId as AnalysisCandidateId) || seen.has(policy.candidateId)) {
        errors.push(issue('POLICY_CANDIDATE_INVALID', `${path}.candidateId`, 'Candidate policies must uniquely cover A through E.'))
      }
      seen.add(policy?.candidateId)
      if (![-1, 0, 1].includes(policy?.direction)) errors.push(issue('POLICY_DIRECTION_INVALID', `${path}.direction`, 'Direction must be -1, 0 or 1.'))
      if (typeof policy?.includeInCoreEac !== 'boolean' || (policy.direction === 0 && policy.includeInCoreEac)) {
        errors.push(issue('POLICY_CORE_INVALID', `${path}.includeInCoreEac`, 'Zero-direction policies cannot be in core EAC.'))
      }
    })
    for (const candidateId of analysisCandidateIds) {
      if (!seen.has(candidateId)) errors.push(issue('POLICY_CANDIDATE_MISSING', 'candidatePolicies', `Candidate ${candidateId} is missing.`))
    }
  }

  if (!Array.isArray(document.experts) || document.experts.length < 2) {
    errors.push(issue('EXPERT_PANEL_TOO_SMALL', 'experts', 'At least two complete experts are required.'))
  } else {
    const codes = new Set<string>()
    document.experts.forEach((expert, index) => {
      const path = `experts[${index}]`
      const code = classifyExpertCode(expert?.expertCode)
      if (!code.valid || codes.has(expert.expertCode)) {
        errors.push(issue('EXPERT_CODE_INVALID', `${path}.expertCode`, 'Use a unique anonymous internal expert code.'))
      } else if (code.shouldWarn) {
        warnings.push(issue('EXPERT_CODE_REQUIRES_REVIEW', `${path}.expertCode`, 'This code resembles a personal name; confirm it is an anonymous research code.'))
      }
      codes.add(expert?.expertCode)
      for (const candidateId of analysisCandidateIds) {
        const score = expert?.scores?.[candidateId]
        if (!finiteNumber(score) || score < 0 || score > 100) {
          errors.push(issue('EXPERT_SCORE_INVALID', `${path}.scores.${candidateId}`, 'Each A-E score must be a finite value from 0 to 100.'))
        }
      }
    })
    if (document.experts.length < 3) warnings.push(issue('EXPERT_PANEL_SIZE_REQUIRES_REVIEW', 'experts', 'A small expert panel is publishable only after research review.'))
  }
  return { errors, warnings }
}

export function validateNormDocument(value: unknown): AnalysisValidationResult {
  const errors: AnalysisIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: [issue('DOCUMENT_INVALID', '', 'A norm document is required.')], warnings: [] }
  const document = value as Partial<NormDocument>
  if (!validText(document.displayName)) errors.push(issue('DISPLAY_NAME_INVALID', 'displayName', 'A display name is required.'))
  validateRevision(document.expectedRevision, 'expectedRevision', errors)
  if (!validVersion(document.scoringVersion)) errors.push(issue('SCORING_VERSION_INVALID', 'scoringVersion', 'A version identifier is required.'))
  if (!Number.isInteger(document.sampleSize) || (document.sampleSize as number) < 2) errors.push(issue('SAMPLE_SIZE_INVALID', 'sampleSize', 'At least two observations are required.'))
  if (!validText(document.populationNote)) errors.push(issue('POPULATION_NOTE_REQUIRED', 'populationNote', 'A population note is required.'))
  for (const metric of analysisMetricCodes) {
    const parameter = document.metrics?.[metric]
    if (!finiteNumber(parameter?.mean) || !finiteNumber(parameter?.sd) || (parameter?.sd ?? 0) <= 0) {
      errors.push(issue('NORM_PARAMETER_INVALID', `metrics.${metric}`, 'Each metric needs a finite mean and positive SD.'))
    }
  }
  return { errors, warnings: [] }
}

export function validateReliabilityDocument(value: unknown): AnalysisValidationResult {
  const errors: AnalysisIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: [issue('DOCUMENT_INVALID', '', 'A reliability document is required.')], warnings: [] }
  const document = value as Partial<ReliabilityDocument>
  if (!validText(document.displayName)) errors.push(issue('DISPLAY_NAME_INVALID', 'displayName', 'A display name is required.'))
  validateRevision(document.expectedRevision, 'expectedRevision', errors)
  if (!validVersion(document.scoringVersion)) errors.push(issue('SCORING_VERSION_INVALID', 'scoringVersion', 'A version identifier is required.'))
  if (!Number.isInteger(document.sampleSize) || (document.sampleSize as number) < 2) errors.push(issue('SAMPLE_SIZE_INVALID', 'sampleSize', 'At least two observations are required.'))
  if (!validText(document.populationNote)) errors.push(issue('POPULATION_NOTE_REQUIRED', 'populationNote', 'A population note is required.'))
  if (document.metricCode !== 'EAC') errors.push(issue('METRIC_CODE_INVALID', 'metricCode', 'Only EAC reliability is supported.'))
  if (!finiteNumber(document.sdValue) || (document.sdValue ?? 0) <= 0) errors.push(issue('RELIABILITY_SD_INVALID', 'sdValue', 'SD must be finite and positive.'))
  if (!finiteNumber(document.reliabilityValue) || (document.reliabilityValue ?? 0) <= 0 || (document.reliabilityValue ?? 0) > 1) {
    errors.push(issue('RELIABILITY_VALUE_INVALID', 'reliabilityValue', 'Reliability must be in (0, 1].'))
  }
  return { errors, warnings: [] }
}

export function validateScoringDefinitionDocument(value: unknown): AnalysisValidationResult {
  const errors: AnalysisIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: [issue('DOCUMENT_INVALID', '', 'A scoring definition is required.')], warnings: [] }
  const document = value as Partial<ScoringDefinitionDocument>
  if (!validText(document.displayName)) errors.push(issue('DISPLAY_NAME_INVALID', 'displayName', 'A display name is required.'))
  validateRevision(document.expectedRevision, 'expectedRevision', errors)
  if (document.formulaFamily !== 'RDI-2.0') errors.push(issue('FORMULA_FAMILY_INVALID', 'formulaFamily', 'Only RDI-2.0 is supported.'))
  if (document.timeUnit !== 'second') errors.push(issue('TIME_UNIT_INVALID', 'timeUnit', 'Time unit must be second.'))
  if (typeof document.totalRdiEnabled !== 'boolean') errors.push(issue('TOTAL_RDI_INVALID', 'totalRdiEnabled', 'totalRdiEnabled must be boolean.'))
  if (document.levelEnabled !== false) errors.push(issue('LEVELS_FORBIDDEN', 'levelEnabled', 'Levels are not enabled in this stage.'))
  if (document.missingPolicy !== 'strict_complete_case') errors.push(issue('MISSING_POLICY_INVALID', 'missingPolicy', 'Only strict complete-case RDI is allowed.'))
  if (document.eacAggregation !== 'available_case' || document.eacsAggregation !== 'available_case') errors.push(issue('AGGREGATION_INVALID', 'aggregation', 'EAC and EACS use available-case aggregation.'))
  if (document.riskAnchor !== 'earliest_key_risk') errors.push(issue('RISK_ANCHOR_INVALID', 'riskAnchor', 'The earliest key risk is required.'))
  if (document.slsMapping?.stopLoss !== 100 || document.slsMapping?.giveUp !== 80 || document.slsMapping?.continue !== 30) errors.push(issue('SLS_MAPPING_INVALID', 'slsMapping', 'SLS mapping is fixed.'))
  const sum = analysisMetricCodes.reduce((total, code) => total + (document.weights?.[code] ?? Number.NaN), 0)
  if (analysisMetricCodes.some((code) => !finiteNumber(document.weights?.[code])) || Math.abs(sum - 1) > 1e-9) {
    errors.push(issue('WEIGHTS_INVALID', 'weights', 'Five finite weights must sum to one.'))
  }
  return { errors, warnings: [] }
}
