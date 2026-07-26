import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { candidateById } from '../data/candidates'
import type { CandidateRuntimeState } from '../types/game'
import { CandidateDetail } from './CandidateDetail'

const runtime: CandidateRuntimeState = {
  candidateId: 'B',
  ratings: { T1: { value: 60, elapsedSec: 0 } },
  spentPoints: 1,
  shallowCount: 1,
  deepCount: 0,
  shallowUnlocked: true,
  deepUnlocked: false,
  negativeEvidenceSeen: false,
  addedAfterNegative: false,
  viewTimeMs: 0,
}

describe('CandidateDetail evidence packets', () => {
  it('renders both T2 source materials after one shallow verification', () => {
    const html = renderToStaticMarkup(
      <CandidateDetail
        candidate={candidateById.B}
        runtime={runtime}
        availablePoints={4}
        investigationLocked={false}
        onVerify={() => undefined}
        onRate={() => undefined}
      />,
    )

    expect(html).toContain('调研报告与数据文件')
    expect(html).toContain('实习证明与工作记录')
  })
})
