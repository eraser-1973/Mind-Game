export type ConfigurationIssue = {
  code: string
  path: string
  message: string
}

export type PublicMaterialProfile = {
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

export type MaterialEvidence = {
  evidenceId: string
  candidateId: string
  level: 'shallow' | 'deep'
  order: number
  title: string
  content: string
  polarity: 'positive' | 'negative'
  isKeyRisk: boolean
}

export type MaterialDocument = {
  profiles: PublicMaterialProfile[]
  evidence: MaterialEvidence[]
}

const candidateIds = ['A', 'B', 'C', 'D', 'E'] as const
const hiddenFields = new Set([
  'trueAbility', 'trueFit', 'isToxic', 'riskFlags', 'baselineFitScore',
  'expectedScoreRanges', 'expectedUpdate', 'dimensionScores', 'trueStrengths',
  'mainShortcomings', 'benchmark', 'correctCandidate',
])

function unknownKeys(value: unknown, allowed: readonly string[], path: string): ConfigurationIssue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const known = new Set(allowed)
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => !known.has(key))
    .map((key) => issue('UNKNOWN_FIELD', path ? `${path}.${key}` : key, 'The material contains an unknown field.'))
}

function issue(code: string, path: string, message: string): ConfigurationIssue {
  return { code, path, message }
}

function findHidden(value: unknown, path = ''): ConfigurationIssue[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((item, index) => findHidden(item, `${path}[${index}]`))
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(hiddenFields.has(key)
      ? [issue('HIDDEN_FIELD_FORBIDDEN', path ? `${path}.${key}` : key, 'Hidden assessment fields cannot be stored in public material.')]
      : []),
    ...findHidden(child, path ? `${path}.${key}` : key),
  ])
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateStringArray(value: unknown, path: string): ConfigurationIssue[] {
  if (!Array.isArray(value) || value.some((item) => !validText(item))) {
    return [issue('STRING_ARRAY_INVALID', path, 'The field must be an array of non-empty strings.')]
  }
  return []
}

export function validateMaterialDocument(value: unknown): ConfigurationIssue[] {
  const errors = findHidden(value)
  if (!value || typeof value !== 'object') {
    return [...errors, issue('MATERIAL_DOCUMENT_INVALID', '', 'A material document object is required.')]
  }
  errors.push(...unknownKeys(value, ['profiles', 'evidence'], ''))
  const document = value as Partial<MaterialDocument>
  if (!Array.isArray(document.profiles)) {
    errors.push(issue('PROFILES_INVALID', 'profiles', 'Profiles must be an array.'))
  }
  if (!Array.isArray(document.evidence)) {
    errors.push(issue('EVIDENCE_INVALID', 'evidence', 'Evidence must be an array.'))
  }
  if (!Array.isArray(document.profiles) || !Array.isArray(document.evidence)) return errors

  if (document.profiles.length !== 5) {
    errors.push(issue('PROFILE_COUNT_INVALID', 'profiles', 'Exactly five candidate profiles are required.'))
  }
  if (document.evidence.length !== 20) {
    errors.push(issue('EVIDENCE_COUNT_INVALID', 'evidence', 'Exactly twenty evidence items are required.'))
  }
  const profileIds = new Set<string>()
  const displayOrders = new Set<number>()
  document.profiles.forEach((profile, index) => {
    const path = `profiles[${index}]`
    errors.push(...unknownKeys(profile, [
      'candidateId', 'displayOrder', 'name', 'role', 'school', 'visibleHalo',
      'resumeSummary', 'education', 'skills', 'experiences', 'initialImage', 'publicTags',
    ], path))
    if (!candidateIds.includes(profile.candidateId as typeof candidateIds[number])) {
      errors.push(issue('CANDIDATE_ID_INVALID', `${path}.candidateId`, 'Candidate ID must be A through E.'))
    }
    if (profileIds.has(profile.candidateId)) {
      errors.push(issue('CANDIDATE_DUPLICATE', `${path}.candidateId`, 'Candidate IDs must be unique.'))
    }
    profileIds.add(profile.candidateId)
    if (!Number.isInteger(profile.displayOrder) || profile.displayOrder < 1 || profile.displayOrder > 5 || displayOrders.has(profile.displayOrder)) {
      errors.push(issue('DISPLAY_ORDER_INVALID', `${path}.displayOrder`, 'Display order must uniquely cover 1 through 5.'))
    }
    displayOrders.add(profile.displayOrder)
    for (const field of ['name', 'role', 'school', 'resumeSummary', 'education', 'initialImage'] as const) {
      if (!validText(profile[field])) errors.push(issue('TEXT_REQUIRED', `${path}.${field}`, 'A non-empty value is required.'))
    }
    errors.push(...validateStringArray(profile.visibleHalo, `${path}.visibleHalo`))
    errors.push(...validateStringArray(profile.skills, `${path}.skills`))
    errors.push(...validateStringArray(profile.publicTags, `${path}.publicTags`))
    if (!Array.isArray(profile.experiences) || profile.experiences.length < 1) {
      errors.push(issue('EXPERIENCES_INVALID', `${path}.experiences`, 'At least one experience is required.'))
    } else {
      profile.experiences.forEach((experience, experienceIndex) => {
        errors.push(...unknownKeys(experience, ['title', 'content'], `${path}.experiences[${experienceIndex}]`))
        if (!validText(experience?.title) || !validText(experience?.content)) {
          errors.push(issue('EXPERIENCE_INVALID', `${path}.experiences[${experienceIndex}]`, 'Experience title and content are required.'))
        }
      })
    }
  })
  for (const id of candidateIds) {
    if (!profileIds.has(id)) errors.push(issue('CANDIDATE_MISSING', 'profiles', `Candidate ${id} is missing.`))
  }

  const evidenceIds = new Set<string>()
  let keyRiskCount = 0
  document.evidence.forEach((item, index) => {
    const path = `evidence[${index}]`
    errors.push(...unknownKeys(item, [
      'evidenceId', 'candidateId', 'level', 'order', 'title', 'content', 'polarity', 'isKeyRisk',
    ], path))
    if (!candidateIds.includes(item.candidateId as typeof candidateIds[number])) {
      errors.push(issue('CANDIDATE_ID_INVALID', `${path}.candidateId`, 'Candidate ID must be A through E.'))
    }
    if (!validText(item.evidenceId) || evidenceIds.has(item.evidenceId)) {
      errors.push(issue('EVIDENCE_ID_INVALID', `${path}.evidenceId`, 'Evidence IDs must be non-empty and unique.'))
    }
    evidenceIds.add(item.evidenceId)
    if (item.level !== 'shallow' && item.level !== 'deep') errors.push(issue('EVIDENCE_LEVEL_INVALID', `${path}.level`, 'Evidence level is invalid.'))
    if (item.polarity !== 'positive' && item.polarity !== 'negative') errors.push(issue('EVIDENCE_POLARITY_INVALID', `${path}.polarity`, 'Evidence polarity is invalid.'))
    if (typeof item.isKeyRisk !== 'boolean') errors.push(issue('KEY_RISK_INVALID', `${path}.isKeyRisk`, 'Key risk must be boolean.'))
    if (item.isKeyRisk === true) keyRiskCount += 1
    if (!validText(item.title) || !validText(item.content)) errors.push(issue('EVIDENCE_TEXT_REQUIRED', path, 'Evidence title and content are required.'))
    if (validText(item.title) && validText(item.content) && /<\s*script\b|javascript\s*:|<\s*iframe\b/i.test(`${item.title}\n${item.content}`)) {
      errors.push(issue('SCRIPT_CONTENT_FORBIDDEN', path, 'Evidence material must contain plain text only.'))
    }
  })
  for (const id of candidateIds) {
    for (const level of ['shallow', 'deep'] as const) {
      const items = document.evidence.filter((item) => item.candidateId === id && item.level === level)
      if (items.length !== 2 || items.map(({ order }) => order).sort().join(',') !== '1,2') {
        errors.push(issue('EVIDENCE_STRUCTURE_INVALID', `evidence.${id}.${level}`, 'Each candidate requires evidence positions 1 and 2.'))
      }
    }
  }
  if (keyRiskCount === 0) errors.push(issue('KEY_RISK_REQUIRED', 'evidence', 'At least one key-risk item is required.'))
  return errors
}

export function validatePointRule(value: {
  totalPoints: unknown
  shallowCost: unknown
  deepCost: unknown
}): ConfigurationIssue[] {
  const errors: ConfigurationIssue[] = []
  const { totalPoints, shallowCost, deepCost } = value
  if (!Number.isInteger(totalPoints) || (totalPoints as number) < 1 || (totalPoints as number) > 100) errors.push(issue('POINT_TOTAL_INVALID', 'totalPoints', 'Total points must be an integer from 1 to 100.'))
  if (!Number.isInteger(shallowCost) || (shallowCost as number) <= 0) errors.push(issue('SHALLOW_COST_INVALID', 'shallowCost', 'Shallow cost must be a positive integer.'))
  if (!Number.isInteger(deepCost) || (deepCost as number) <= 0) errors.push(issue('DEEP_COST_INVALID', 'deepCost', 'Deep cost must be a positive integer.'))
  if (Number.isInteger(totalPoints) && Number.isInteger(shallowCost) && Number.isInteger(deepCost)
    && (totalPoints as number) < (shallowCost as number) + (deepCost as number)) {
    errors.push(issue('POINT_TOTAL_INSUFFICIENT', 'totalPoints', 'Total points must support one shallow and one deep verification.'))
  }
  return errors
}

export function validateSunkCostRule(value: {
  triggerRemainingSec: unknown
  minimumCandidateInvestment: unknown
  requiresKeyRisk: unknown
}): ConfigurationIssue[] {
  const errors: ConfigurationIssue[] = []
  if (!Number.isInteger(value.triggerRemainingSec) || (value.triggerRemainingSec as number) <= 0 || (value.triggerRemainingSec as number) >= 900) {
    errors.push(issue('SUNK_TRIGGER_INVALID', 'triggerRemainingSec', 'Trigger time must be an integer from 1 to 899 seconds.'))
  }
  if (!Number.isInteger(value.minimumCandidateInvestment) || (value.minimumCandidateInvestment as number) < 0) {
    errors.push(issue('SUNK_INVESTMENT_INVALID', 'minimumCandidateInvestment', 'Minimum investment must be a non-negative integer.'))
  }
  if (typeof value.requiresKeyRisk !== 'boolean') {
    errors.push(issue('SUNK_KEY_RISK_INVALID', 'requiresKeyRisk', 'requiresKeyRisk must be boolean.'))
  }
  return errors
}

export function isConfigurationVersion(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= 64
    && /^[A-Za-z0-9._-]+$/.test(value)
}
