import type { AnalysisMetricCode } from './analysisConfiguration'

export type MetricWeights = Record<AnalysisMetricCode, number>
export type NormParameter = { mean: number; sd: number }
export type StrictRdiInput = {
  raw: Record<AnalysisMetricCode, number | null>
  parameters: Record<AnalysisMetricCode, NormParameter | null>
  weights: MetricWeights
}

export function sampleMeanAndSd(values: readonly number[]): { mean: number; sampleSd: number } {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) throw new Error('At least two finite values are required.')
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const sampleSd = Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1))
  return { mean, sampleSd }
}

export function calculateRcii(eac: number, reliabilitySd: number, reliability: number): number {
  if (![eac, reliabilitySd, reliability].every(Number.isFinite) || reliabilitySd <= 0 || reliability <= 0 || reliability > 1) throw new Error('Invalid RCIi parameters.')
  const standardErrorMeasurement = reliabilitySd * Math.sqrt(1 - reliability)
  const differenceError = Math.sqrt(2) * standardErrorMeasurement
  if (differenceError === 0) throw new Error('RCIi is undefined when reliability is one.')
  return eac / differenceError
}

export function calculateStrictRdi(input: StrictRdiInput): {
  standardScores: Record<AnalysisMetricCode, { z: number | null; weighted: number | null }>
  rdiZ: number | null
  rdiT: number | null
  missingReasons: string[]
  level?: never
  percentile?: never
} {
  const standardScores = {} as Record<AnalysisMetricCode, { z: number | null; weighted: number | null }>
  const missingReasons: string[] = []
  for (const metric of ['RES', 'EACS', 'DDS', 'GDS', 'SLS'] as const) {
    const raw = input.raw[metric]
    const parameter = input.parameters[metric]
    const weight = input.weights[metric]
    if (raw === null || !Number.isFinite(raw)) {
      missingReasons.push(`${metric}:raw_missing`)
      standardScores[metric] = { z: null, weighted: null }
    } else if (!parameter || !Number.isFinite(parameter.mean) || !Number.isFinite(parameter.sd) || parameter.sd <= 0) {
      missingReasons.push(`${metric}:norm_missing`)
      standardScores[metric] = { z: null, weighted: null }
    } else if (!Number.isFinite(weight)) {
      missingReasons.push(`${metric}:weight_invalid`)
      standardScores[metric] = { z: null, weighted: null }
    } else {
      const z = (raw - parameter.mean) / parameter.sd
      standardScores[metric] = { z, weighted: z * weight }
    }
  }
  if (missingReasons.length > 0) return { standardScores, rdiZ: null, rdiT: null, missingReasons }
  const rdiZ = (Object.values(standardScores) as Array<{ z: number; weighted: number }>)
    .reduce((total, item) => total + item.weighted, 0)
  return { standardScores, rdiZ, rdiT: 50 + (10 * rdiZ), missingReasons: [] }
}
