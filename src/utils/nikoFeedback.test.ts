import { describe, expect, it } from 'vitest'
import { candidateById } from '../data/candidates'
import type { CandidateRuntimeState } from '../types/game'
import {
  createNikoFeedback,
  getNikoMood,
  getRatingDirection,
} from './nikoFeedback'

const runtimeWithRatings = (
  t1: number,
  t2?: number,
): CandidateRuntimeState => ({
  candidateId: 'B',
  ratings: {
    T1: { value: t1, elapsedSec: 10 },
    ...(t2 === undefined
      ? {}
      : { T2: { value: t2, elapsedSec: 20 } }),
  },
  spentPoints: 1,
  shallowCount: 1,
  deepCount: 0,
  shallowUnlocked: true,
  deepUnlocked: false,
  viewedEvidenceIds: [],
  negativeEvidenceSeen: false,
  addedAfterNegative: false,
  viewTimeMs: 0,
})

describe('Niko feedback', () => {
  it('classifies score movement relative to the sealed baseline', () => {
    expect(getRatingDirection(70, 50)).toBe('higher')
    expect(getRatingDirection(35, 50)).toBe('lower')
    expect(getRatingDirection(50, 50)).toBeNull()
  })

  it('maps evidence polarity and rating direction to mood', () => {
    expect(getNikoMood('positive', 'higher')).toBe('happy')
    expect(getNikoMood('positive', 'lower')).toBe('angry')
    expect(getNikoMood('negative', 'lower')).toBe('happy')
    expect(getNikoMood('negative', 'higher')).toBe('angry')
  })

  it('uses T1 as the T2 baseline and references the new B material packet', () => {
    const message = createNikoFeedback({
      candidate: candidateById.B,
      runtime: runtimeWithRatings(50),
      stage: 'T2',
      value: 70,
      timestamp: 30,
    })

    expect(message?.mood).toBe('happy')
    expect(message?.relatedEvidenceId).toBe('B-t2-1')
    expect(message?.text).toContain('调研报告与数据文件')
  })

  it('uses T2 as the T3 baseline and rewards lowering on negative evidence', () => {
    const runtime = runtimeWithRatings(40, 80)
    runtime.candidateId = 'A'
    runtime.deepUnlocked = true
    const message = createNikoFeedback({
      candidate: candidateById.A,
      runtime,
      stage: 'T3',
      value: 60,
      timestamp: 40,
    })

    expect(message?.mood).toBe('happy')
    expect(message?.relatedEvidenceId).toBe('A-t3-1')
    expect(message?.text).toContain('竞赛分工与团队反馈')
  })

  it('does not generate feedback when the score matches its baseline', () => {
    const message = createNikoFeedback({
      candidate: candidateById.B,
      runtime: runtimeWithRatings(50),
      stage: 'T2',
      value: 50,
      timestamp: 30,
    })

    expect(message).toBeNull()
  })
})
