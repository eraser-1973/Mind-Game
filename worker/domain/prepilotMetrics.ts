export type MetricStatus =
  | 'calculated'
  | 'partial'
  | 'unavailable'
  | 'not_applicable'
  | 'pending_parameters'
  | 'norms_unavailable'

type BenchmarkMetricResult = {
  value: number
  status: 'calculated' | 'partial'
}

const RDI_METRICS = ['RES', 'EACS', 'DDS', 'GDS', 'SLS'] as const
type RdiMetric = (typeof RDI_METRICS)[number]

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
}

function assertRange(value: number, min: number, max: number, label: string) {
  assertFinite(value, label)
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`)
  }
}

function assertPositive(value: number, label: string) {
  assertFinite(value, label)
  if (value <= 0) throw new Error(`${label} must be positive`)
}

function assertDirection(direction: number): asserts direction is -1 | 0 | 1 {
  if (direction !== -1 && direction !== 0 && direction !== 1) {
    throw new Error('direction must be -1, 0, or 1')
  }
}

export function calculateRes(input: {
  benchmarkValue: number
  costAfterRisk: number
  totalPoints: number
  benchmarkIsProvisional: boolean
}): BenchmarkMetricResult {
  assertRange(input.benchmarkValue, 0, 100, 'benchmarkValue')
  assertPositive(input.totalPoints, 'totalPoints')
  assertRange(input.costAfterRisk, 0, input.totalPoints, 'costAfterRisk')
  const value = input.benchmarkValue *
    (1 - input.costAfterRisk / input.totalPoints)
  assertRange(value, 0, 100, 'RES')
  return {
    value,
    status: input.benchmarkIsProvisional ? 'partial' : 'calculated',
  }
}

export function calculateEacComponent(
  direction: -1 | 0 | 1,
  t1: number,
  t3: number,
): number | null {
  assertDirection(direction)
  assertRange(t1, 0, 100, 't1')
  assertRange(t3, 0, 100, 't3')
  if (direction === 0) return null
  return direction * (t3 - t1)
}

export function calculateEacsComponent(
  direction: -1 | 0 | 1,
  t1: number,
  t3: number,
  deltaTimeSec: number,
): number | null {
  assertDirection(direction)
  assertRange(t1, 0, 100, 't1')
  assertRange(t3, 0, 100, 't3')
  assertPositive(deltaTimeSec, 'deltaTimeSec')
  if (direction === 0) return null
  const value = direction * ((t3 - t1) / deltaTimeSec)
  assertFinite(value, 'EACSi')
  return value
}

export function aggregateAvailableCase(
  values: Record<string, number | null>,
  requiredCandidateIds: readonly string[],
): {
  value: number | null
  status: 'calculated' | 'partial' | 'unavailable'
  coverageCount: number
  requiredCount: number
  missingCandidateIds: string[]
} {
  if (requiredCandidateIds.length === 0 ||
    new Set(requiredCandidateIds).size !== requiredCandidateIds.length) {
    throw new Error('requiredCandidateIds must be a non-empty unique list')
  }
  const available: number[] = []
  const missingCandidateIds: string[] = []
  for (const candidateId of requiredCandidateIds) {
    const value = values[candidateId]
    if (value === null || value === undefined) {
      missingCandidateIds.push(candidateId)
      continue
    }
    assertFinite(value, `${candidateId} component`)
    available.push(value)
  }
  const coverageCount = available.length
  const requiredCount = requiredCandidateIds.length
  if (coverageCount === 0) {
    return {
      value: null,
      status: 'unavailable',
      coverageCount,
      requiredCount,
      missingCandidateIds,
    }
  }
  return {
    value: available.reduce((total, value) => total + value, 0) / coverageCount,
    status: coverageCount === requiredCount ? 'calculated' : 'partial',
    coverageCount,
    requiredCount,
    missingCandidateIds,
  }
}

export function calculateRci(
  eac: number,
  sd: number,
  reliability: number,
): number {
  assertFinite(eac, 'eac')
  assertPositive(sd, 'sd')
  assertRange(reliability, Number.MIN_VALUE, 1, 'reliability')
  const standardError = sd * Math.sqrt(1 - reliability)
  const differenceError = Math.sqrt(2) * standardError
  if (!Number.isFinite(differenceError) || differenceError <= 0) {
    throw new Error('reliability parameters yield a zero or invalid Sdiff')
  }
  const value = eac / differenceError
  assertFinite(value, 'RCI')
  return value
}

export function calculateDds(input: {
  costAfterRisk: number
  totalPoints: number
  timeAfterRiskSec: number
  totalTimeSec: number
}): number {
  assertPositive(input.totalPoints, 'totalPoints')
  assertRange(input.costAfterRisk, 0, input.totalPoints, 'costAfterRisk')
  assertPositive(input.totalTimeSec, 'totalTimeSec')
  assertRange(input.timeAfterRiskSec, 0, input.totalTimeSec, 'timeAfterRiskSec')
  const value = 100 * (
    1 - 0.5 * (input.costAfterRisk / input.totalPoints) -
    0.5 * (input.timeAfterRiskSec / input.totalTimeSec)
  )
  assertRange(value, 0, 100, 'DDS')
  return value
}

export function calculateGds(input: {
  shallowCandidateCount: number
  candidateCount: number
  benchmarkValue: number
  benchmarkIsProvisional: boolean
}): BenchmarkMetricResult {
  if (!Number.isInteger(input.candidateCount) || input.candidateCount <= 0) {
    throw new Error('candidateCount must be a positive integer')
  }
  if (!Number.isInteger(input.shallowCandidateCount)) {
    throw new Error('shallowCandidateCount must be an integer')
  }
  assertRange(
    input.shallowCandidateCount,
    0,
    input.candidateCount,
    'shallowCandidateCount',
  )
  assertRange(input.benchmarkValue, 0, 100, 'benchmarkValue')
  const value = (input.shallowCandidateCount / input.candidateCount) *
    input.benchmarkValue
  assertRange(value, 0, 100, 'GDS')
  return {
    value,
    status: input.benchmarkIsProvisional ? 'partial' : 'calculated',
  }
}

export function calculateSls(
  choiceStatus: string,
  choice: string | null,
): {
  value: number | null
  status: MetricStatus
  missingReason: string | null
} {
  if (choiceStatus === 'not_triggered') {
    return {
      value: null,
      status: 'not_applicable',
      missingReason: 'sunk_cost_not_triggered',
    }
  }
  if (choiceStatus === 'timeout_unanswered') {
    return {
      value: null,
      status: 'unavailable',
      missingReason: 'sunk_cost_timeout_unanswered',
    }
  }
  if (choiceStatus !== 'answered' || choice === null) {
    return {
      value: null,
      status: 'unavailable',
      missingReason: 'sunk_cost_choice_missing',
    }
  }
  const mapping: Record<string, number> = {
    stop_loss: 100,
    give_up: 80,
    continue: 30,
  }
  const value = mapping[choice]
  if (value === undefined) {
    return {
      value: null,
      status: 'unavailable',
      missingReason: 'sunk_cost_choice_invalid',
    }
  }
  return { value, status: 'calculated', missingReason: null }
}

export function calculateRdiWithNorms(
  values: Record<RdiMetric, number>,
  norms: Record<RdiMetric, { mean: number; sd: number }>,
): { rdiZ: number; rdiT: number } {
  const z = {} as Record<RdiMetric, number>
  for (const metric of RDI_METRICS) {
    const value = values?.[metric]
    const norm = norms?.[metric]
    assertFinite(value, `${metric} value`)
    if (!norm) throw new Error(`${metric} norm is required`)
    assertFinite(norm.mean, `${metric} mean`)
    assertPositive(norm.sd, `${metric} sd`)
    z[metric] = (value - norm.mean) / norm.sd
  }
  const rdiZ = 0.35 * z.RES + 0.35 * z.EACS + 0.15 * z.DDS +
    0.1 * z.GDS + 0.05 * z.SLS
  const rdiT = 50 + 10 * rdiZ
  assertFinite(rdiZ, 'RDIz')
  assertFinite(rdiT, 'RDIT')
  return { rdiZ, rdiT }
}
