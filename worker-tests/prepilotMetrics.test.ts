import { describe, expect, it } from 'vitest'
import {
  aggregateAvailableCase,
  calculateDds,
  calculateEacComponent,
  calculateEacsComponent,
  calculateGds,
  calculateRci,
  calculateRdiWithNorms,
  calculateRes,
  calculateSls,
} from '../worker/domain/prepilotMetrics'
import {
  canonicalizeScoringInput,
  fingerprintScoringInput,
} from '../worker/domain/scoringFingerprint'

describe('prepilot scoring formulas', () => {
  describe('RES', () => {
    it('matches the hand calculation and marks a provisional benchmark partial', () => {
      expect(calculateRes({
        benchmarkValue: 80,
        costAfterRisk: 1,
        totalPoints: 5,
        benchmarkIsProvisional: true,
      })).toEqual({ value: 64, status: 'partial' })
    })

    it.each([
      [0, 80],
      [5, 0],
    ])('handles costAfterRisk=%s', (costAfterRisk, expected) => {
      expect(calculateRes({
        benchmarkValue: 80,
        costAfterRisk,
        totalPoints: 5,
        benchmarkIsProvisional: false,
      })).toEqual({ value: expected, status: 'calculated' })
    })

    it.each([
      { benchmarkValue: 80, costAfterRisk: 0, totalPoints: 0 },
      { benchmarkValue: 80, costAfterRisk: -1, totalPoints: 5 },
      { benchmarkValue: 80, costAfterRisk: 6, totalPoints: 5 },
      { benchmarkValue: 101, costAfterRisk: 0, totalPoints: 5 },
    ])('rejects invalid input %#', (input) => {
      expect(() => calculateRes({ ...input, benchmarkIsProvisional: false }))
        .toThrow()
    })
  })

  describe('EAC and EACS', () => {
    it('matches the A hand calculations', () => {
      expect(calculateEacComponent(-1, 80, 50)).toBe(30)
      expect(calculateEacsComponent(-1, 80, 50, 120)).toBeCloseTo(0.25)
    })

    it('applies positive direction and preserves legitimate zero', () => {
      expect(calculateEacComponent(1, 50, 70)).toBe(20)
      expect(calculateEacComponent(1, 50, 50)).toBe(0)
      expect(calculateEacsComponent(1, 50, 50, 10)).toBe(0)
    })

    it('excludes direction zero instead of treating it as a core zero', () => {
      expect(calculateEacComponent(0, 50, 80)).toBeNull()
      expect(calculateEacsComponent(0, 50, 80, 30)).toBeNull()
    })

    it.each([
      () => calculateEacComponent(-1, -1, 50),
      () => calculateEacComponent(1, 50, 101),
      () => calculateEacsComponent(1, 50, 80, 0),
      () => calculateEacsComponent(-1, 50, 80, Number.NaN),
    ])('rejects invalid score/time input', (run) => {
      expect(run).toThrow()
    })

    it.each([
      [{ A: null, B: null, C: null, D: null }, null, 'unavailable', 0],
      [{ A: 30, B: null, C: null, D: null }, 30, 'partial', 1],
      [{ A: 30, B: 20, C: null, D: -10 }, 40 / 3, 'partial', 3],
      [{ A: 30, B: 20, C: 10, D: 0 }, 15, 'calculated', 4],
    ] as const)(
      'uses available-case coverage %#',
      (values, value, status, coverageCount) => {
        const result = aggregateAvailableCase(values, ['A', 'B', 'C', 'D'])
        expect(result.value).toBe(value)
        expect(result.status).toBe(status)
        expect(result.coverageCount).toBe(coverageCount)
        expect(result.requiredCount).toBe(4)
        expect(result.missingCandidateIds).toHaveLength(4 - coverageCount)
      },
    )
  })

  describe('RCI', () => {
    it('matches the explicit SD and reliability hand calculation', () => {
      const expected = 30 / (Math.sqrt(2) * 10 * Math.sqrt(1 - 0.84))
      expect(calculateRci(30, 10, 0.84)).toBeCloseTo(expected)
    })

    it.each([
      [0, 0.84],
      [-1, 0.84],
      [10, 0],
      [10, -0.1],
      [10, 1],
      [10, 1.01],
    ])('rejects sd=%s reliability=%s', (sd, reliability) => {
      expect(() => calculateRci(30, sd, reliability)).toThrow()
    })
  })

  describe('DDS', () => {
    it('matches the hand calculation', () => {
      expect(calculateDds({
        costAfterRisk: 1,
        totalPoints: 5,
        timeAfterRiskSec: 120,
        totalTimeSec: 600,
      })).toBeCloseTo(80)
    })

    it.each([
      { costAfterRisk: -1, totalPoints: 5, timeAfterRiskSec: 0, totalTimeSec: 600 },
      { costAfterRisk: 6, totalPoints: 5, timeAfterRiskSec: 0, totalTimeSec: 600 },
      { costAfterRisk: 0, totalPoints: 0, timeAfterRiskSec: 0, totalTimeSec: 600 },
      { costAfterRisk: 0, totalPoints: 5, timeAfterRiskSec: -1, totalTimeSec: 600 },
      { costAfterRisk: 0, totalPoints: 5, timeAfterRiskSec: 601, totalTimeSec: 600 },
      { costAfterRisk: 0, totalPoints: 5, timeAfterRiskSec: 0, totalTimeSec: 0 },
    ])('rejects invalid input without clamping %#', (input) => {
      expect(() => calculateDds(input)).toThrow()
    })
  })

  describe('GDS', () => {
    it('matches the hand calculation and marks provisional input partial', () => {
      expect(calculateGds({
        shallowCandidateCount: 2,
        candidateCount: 5,
        benchmarkValue: 80,
        benchmarkIsProvisional: true,
      })).toEqual({ value: 32, status: 'partial' })
    })

    it('allows zero distinct shallow candidates', () => {
      expect(calculateGds({
        shallowCandidateCount: 0,
        candidateCount: 5,
        benchmarkValue: 86,
        benchmarkIsProvisional: false,
      })).toEqual({ value: 0, status: 'calculated' })
    })

    it.each([
      { shallowCandidateCount: -1, candidateCount: 5, benchmarkValue: 80 },
      { shallowCandidateCount: 6, candidateCount: 5, benchmarkValue: 80 },
      { shallowCandidateCount: 1.5, candidateCount: 5, benchmarkValue: 80 },
      { shallowCandidateCount: 0, candidateCount: 0, benchmarkValue: 80 },
      { shallowCandidateCount: 0, candidateCount: 5, benchmarkValue: -1 },
    ])('rejects invalid coverage %#', (input) => {
      expect(() => calculateGds({ ...input, benchmarkIsProvisional: false }))
        .toThrow()
    })
  })

  describe('SLS', () => {
    it.each([
      ['stop_loss', 100],
      ['give_up', 80],
      ['continue', 30],
    ])('maps %s to %s', (choice, value) => {
      expect(calculateSls('answered', choice)).toEqual({
        value,
        status: 'calculated',
        missingReason: null,
      })
    })

    it('keeps not-triggered null and not applicable', () => {
      expect(calculateSls('not_triggered', 'not_triggered')).toEqual({
        value: null,
        status: 'not_applicable',
        missingReason: 'sunk_cost_not_triggered',
      })
    })

    it('keeps timeout-unanswered null and unavailable', () => {
      expect(calculateSls('timeout_unanswered', null)).toEqual({
        value: null,
        status: 'unavailable',
        missingReason: 'sunk_cost_timeout_unanswered',
      })
    })

    it('keeps a missing choice unavailable rather than inventing a score', () => {
      expect(calculateSls('answered', null)).toEqual({
        value: null,
        status: 'unavailable',
        missingReason: 'sunk_cost_choice_missing',
      })
    })
  })

  describe('future RDI formula', () => {
    const values = { RES: 64, EACS: 0.25, DDS: 80, GDS: 32, SLS: 100 }
    const norms = {
      RES: { mean: 50, sd: 10 },
      EACS: { mean: 0, sd: 0.5 },
      DDS: { mean: 50, sd: 10 },
      GDS: { mean: 40, sd: 10 },
      SLS: { mean: 50, sd: 25 },
    }

    it('calculates only when explicit complete norms are supplied', () => {
      const expectedZ = 0.35 * 1.4 + 0.35 * 0.5 + 0.15 * 3 +
        0.1 * -0.8 + 0.05 * 2
      expect(calculateRdiWithNorms(values, norms)).toEqual({
        rdiZ: expectedZ,
        rdiT: 50 + 10 * expectedZ,
      })
    })

    it('rejects a missing/defaulted or zero-SD norm', () => {
      expect(() => calculateRdiWithNorms(values, {
        ...norms,
        RES: { mean: 0, sd: 0 },
      })).toThrow()
      const missing = { ...norms } as Partial<typeof norms>
      delete missing.SLS
      expect(() => calculateRdiWithNorms(values, missing as typeof norms)).toThrow()
    })
  })
})

describe('canonical scoring source fingerprint', () => {
  it('sorts object keys recursively while preserving array sequence', async () => {
    const left = { z: 1, nested: { b: 2, a: 1 }, rows: [{ y: 2, x: 1 }, 'B'] }
    const reordered = { rows: [{ x: 1, y: 2 }, 'B'], nested: { a: 1, b: 2 }, z: 1 }
    expect(canonicalizeScoringInput(left)).toBe(canonicalizeScoringInput(reordered))
    expect(await fingerprintScoringInput(left)).toBe(
      await fingerprintScoringInput(reordered),
    )
    expect(await fingerprintScoringInput(left)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when ordered events or source values change', async () => {
    const base = { events: [{ sequenceNo: 1 }, { sequenceNo: 2 }], score: 50 }
    expect(await fingerprintScoringInput(base)).not.toBe(
      await fingerprintScoringInput({ events: [...base.events].reverse(), score: 50 }),
    )
    expect(await fingerprintScoringInput(base)).not.toBe(
      await fingerprintScoringInput({ ...base, score: 51 }),
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, new Date()])(
    'rejects non-canonical input %s',
    (value) => {
      expect(() => canonicalizeScoringInput({ value })).toThrow()
    },
  )

  it('does not mutate the source object', () => {
    const value = { b: 2, a: { d: 4, c: 3 } }
    const before = JSON.stringify(value)
    canonicalizeScoringInput(value)
    expect(JSON.stringify(value)).toBe(before)
  })
})
