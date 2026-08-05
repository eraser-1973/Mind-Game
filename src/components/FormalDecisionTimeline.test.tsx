import { create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { FormalDecisionTimeline } from './FormalDecisionTimeline'

describe('FormalDecisionTimeline', () => {
  it('shows the sealed T1 choice, the removed T2 checkpoint, and the pending final decision without inventing a candidate', () => {
    const tree = create(<FormalDecisionTimeline
      stageChoices={[{ stage: 'T1', candidateId: 'B', confidence: 72, sealed: true, sequenceNo: 7, serverSubmittedAt: '2026-08-05T00:00:00.000Z' }]}
      finalDecision={null}
    />)
    const rows = tree.root.findAllByType('li').map((item) => item.children.join(''))
    expect(rows).toContain('T1 后选择：候选人 B')
    expect(rows).toContain('T2 阶段选择：本版本未设置')
    expect(rows).toContain('最终选择：待完成')
    expect(rows.join('')).not.toContain('候选人 A')
  })
})
