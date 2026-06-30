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

describe('ReportScreen', () => {
  it('keeps restart action while removing the export json action', () => {
    const html = renderToStaticMarkup(
      <ReportScreen
        report={buildReport()}
        onRestart={() => undefined}
      />,
    )

    expect(html).toContain('重新开始')
    expect(html).not.toContain('导出 JSON 数据')
  })
})
