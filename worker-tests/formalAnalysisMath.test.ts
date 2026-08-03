import { describe, expect, it } from 'vitest'
import {
  calculateRcii,
  calculateStrictRdi,
  sampleMeanAndSd,
} from '../worker/domain/formalAnalysisMath'

const weights = { RES: 0.35, EACS: 0.35, DDS: 0.15, GDS: 0.1, SLS: 0.05 } as const

describe('formal analysis math', () => {
  it('uses sample rather than population SD and produces candidate-level RCIi', () => {
    expect(sampleMeanAndSd([52, 56])).toEqual({ mean: 54, sampleSd: Math.sqrt(8) })
    expect(calculateRcii(12, 10, 0.64)).toBeCloseTo(12 / Math.sqrt(2 * (10 ** 2) * (1 - 0.64)))
  })

  it('keeps RDI unavailable under strict complete-case when any source value is missing', () => {
    expect(calculateStrictRdi({
      raw: { RES: 1, EACS: 1, DDS: null, GDS: 1, SLS: 1 },
      parameters: {
        RES: { mean: 0, sd: 1 }, EACS: { mean: 0, sd: 1 }, DDS: { mean: 0, sd: 1 },
        GDS: { mean: 0, sd: 1 }, SLS: { mean: 0, sd: 1 },
      },
      weights,
    })).toMatchObject({ rdiZ: null, rdiT: null, missingReasons: ['DDS:raw_missing'] })
  })

  it('creates no level or percentile artefact when all five standard scores exist', () => {
    const result = calculateStrictRdi({
      raw: { RES: 1, EACS: 2, DDS: 3, GDS: 4, SLS: 5 },
      parameters: {
        RES: { mean: 0, sd: 1 }, EACS: { mean: 0, sd: 1 }, DDS: { mean: 0, sd: 1 },
        GDS: { mean: 0, sd: 1 }, SLS: { mean: 0, sd: 1 },
      },
      weights,
    })
    expect(result).toMatchObject({ rdiZ: 2.15, rdiT: 71.5 })
    expect(result).not.toHaveProperty('level')
    expect(result).not.toHaveProperty('percentile')
  })
})
