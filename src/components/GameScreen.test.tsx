import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  ratingsComplete: false,
  state: null as Awaited<
    ReturnType<typeof import('../state/gameReducer')['createInitialGameState']>
  > | null,
  setState: null as null | ((complete: boolean) => void),
}))

vi.mock('../state/gameReducer', async () => {
  const actual = await vi.importActual<typeof import('../state/gameReducer')>(
    '../state/gameReducer',
  )
  const buildState = (complete: boolean) => {
    const state = actual.createInitialGameState('quick', 1_000)

    if (complete) {
      for (const candidateId of Object.keys(state.runtime)) {
        state.runtime[candidateId].ratings.T1 = {
          value: 50,
          elapsedSec: 0,
        }
      }
    }

    return state
  }

  mockState.state ??= buildState(false)
  mockState.setState = (complete: boolean) => {
    mockState.ratingsComplete = complete
    mockState.state = buildState(complete)
  }

  return {
    ...actual,
    allT1Rated: () => mockState.ratingsComplete,
    createInitialGameState: () => mockState.state ?? buildState(false),
  }
})

vi.mock('./CandidateList', () => ({
  CandidateList: () => <div>CandidateList</div>,
}))

vi.mock('./CandidateDetail', () => ({
  CandidateDetail: () => <div>CandidateDetail</div>,
}))

vi.mock('./FinalDecisionPanel', () => ({
  FinalDecisionPanel: () => <div>FinalDecisionPanel</div>,
}))

vi.mock('./HRChatPanel', () => ({
  HRChatPanel: () => <div>HRChatPanel</div>,
}))

vi.mock('./ReportScreen', () => ({
  ReportScreen: () => <div>ReportScreen</div>,
}))

vi.mock('./SunkCostModal', () => ({
  SunkCostModal: () => <div>SunkCostModal</div>,
}))

vi.mock('./TimerBar', () => ({
  TimerBar: () => <div>TimerBar</div>,
}))

import { GameScreen } from './GameScreen'

describe('GameScreen current task copy', () => {
  beforeEach(() => {
    mockState.setState?.(false)
  })

  it('shows the updated second-stage copy after T1 ratings are complete', () => {
    mockState.setState?.(true)

    const html = renderToStaticMarkup(
      <GameScreen mode="quick" onRestart={() => undefined} />,
    )

    expect(html).toContain(
      '可以用查证点数，比较证据并锁定最终人选。',
    )
  })

  it('does not show the second-stage copy before T1 ratings are complete', () => {
    const html = renderToStaticMarkup(
      <GameScreen mode="quick" onRestart={() => undefined} />,
    )

    expect(html).not.toContain(
      '可以用查证点数，比较证据并锁定最终人选。',
    )
  })
})
