import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { candidates } from '../data/candidates'
import { createInitialGameState } from '../state/gameReducer'
import { FinalDecisionPanel } from './FinalDecisionPanel'
import { ScaleQuestion } from './ScaleQuestion'
import { StageSnapshotModal } from './StageSnapshotModal'

describe('decision panels', () => {
  it('shows zero as the unanswered T1 confidence placeholder without enabling submit', () => {
    const html = renderToStaticMarkup(
      <StageSnapshotModal
        stage="T1"
        candidates={candidates}
        onSubmit={() => undefined}
      />,
    )

    expect(html).toContain('<output>0</output>')
    expect(html).not.toContain('未作答')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>提交阶段判断<\/button>/)
  })

  it('starts the final decision without a preselected candidate or enabled submit', () => {
    const state = createInitialGameState('quick', 1_000)
    const html = renderToStaticMarkup(
      <FinalDecisionPanel
        candidates={candidates}
        runtime={state.runtime}
        timeExpired={false}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    )

    expect(html).toContain('<output>0</output>')
    expect(html).not.toContain('未作答')
    expect(html).not.toContain('aria-pressed="true"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>提交最终录用<\/button>/)
  })

  it('formats an unanswered scale as zero while preserving the null input contract', () => {
    const html = renderToStaticMarkup(
      <ScaleQuestion
        id="unanswered-scale"
        label="测试题目"
        value={null}
        min={0}
        max={10}
        leftLabel="0"
        rightLabel="10"
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('<strong>0</strong>')
    expect(html).not.toContain('未作答')
  })
})
