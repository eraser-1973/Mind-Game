function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export async function fingerprintValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function fingerprintRequest(value: unknown): Promise<string> {
  return fingerprintValue(value)
}

export async function fingerprintMaterial(document: {
  profiles: Array<Record<string, unknown>>
  evidence: Array<Record<string, unknown>>
}): Promise<string> {
  return fingerprintValue({
    profiles: [...document.profiles].sort((left, right) =>
      String(left.candidateId).localeCompare(String(right.candidateId))),
    evidence: [...document.evidence].sort((left, right) =>
      String(left.candidateId).localeCompare(String(right.candidateId))
      || String(left.level).localeCompare(String(right.level))
      || Number(left.order) - Number(right.order)),
  })
}

export async function fingerprintPointRule(rule: {
  totalPoints: number
  shallowCost: number
  deepCost: number
}): Promise<string> {
  return fingerprintValue(rule)
}

export async function fingerprintSunkCostRule(rule: {
  triggerRemainingSec: number
  minimumCandidateInvestment: number
  requiresKeyRisk: boolean
}): Promise<string> {
  return fingerprintValue(rule)
}

export async function fingerprintConfiguration(value: {
  taskVersion: string
  materialVersion: string
  materialFingerprint: string
  pointRuleVersion: string
  pointRuleFingerprint: string
  sunkCostRuleVersion: string
  sunkCostRuleFingerprint: string
  scoringVersion: string
  benchmarkVersion: string
  normVersion: string | null
}): Promise<string> {
  return fingerprintValue(value)
}
