import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInitialGameState, gameReducer } from '../state/gameReducer'
import { generateReport } from '../utils/report'
import { ReportScreen } from './ReportScreen'

const buildReport = () => {
  let state = createInitialGameState('quick', 1_000)
  state = gameReducer(state, {
    type: 'RATE',
    candidateId: 'A',
    stage: 'T1',
    value: 50,
  })
  state = gameReducer(state, {
    type: 'RATE',
    candidateId: 'B',
    stage: 'T1',
    value: 52,
  })
  state = gameReducer(state, {
    type: 'RATE',
    candidateId: 'C',
    stage: 'T1',
    value: 88,
  })
  state = gameReducer(state, {
    type: 'RATE',
    candidateId: 'D',
    stage: 'T1',
    value: 74,
  })
  state = gameReducer(state, {
    type: 'RATE',
    candidateId: 'E',
    stage: 'T1',
    value: 63,
  })
  state = { ...state, finalCandidateId: 'C', phase: 'report' }

  return generateReport(state)
}

const buildFormalReport = () => ({ ...buildReport(), mode: 'formal' as const })

describe('ReportScreen', () => {
  it('keeps restart action and exposes JSON export for anonymous data', () => {
    const html = renderToStaticMarkup(
      <ReportScreen
        report={buildReport()}
        onRestart={() => undefined}
      />,
    )

    expect(html).toContain('重新开始')
    expect(html).toContain('导出 JSON 数据')
    expect(html).toContain('岗位匹配基准分')
    expect(html).toContain('数据整理与基础分析能力')
  })

  it('does not expose participant JSON export in formal mode', () => {
    const html = renderToStaticMarkup(
      <ReportScreen report={buildFormalReport()} onRestart={() => undefined} />,
    )

    expect(html).toContain('重新开始')
    expect(html).not.toContain('导出 JSON 数据')
  })

  it('labels manual final submissions separately from timeout submissions', () => {
    let state = createInitialGameState('quick', 1_000)
    state = gameReducer(state, {
      type: 'FINAL_SELECT', candidateId: 'B', confidence: 84,
      submissionType: 'manual', nowMs: 2_000,
    })
    const html = renderToStaticMarkup(
      <ReportScreen report={generateReport(state)} sourceState={state} onRestart={() => undefined} />,
    )
    expect(html).toContain('主动提交')
    expect(html).toContain('最终信心 84/100')
  })
})
