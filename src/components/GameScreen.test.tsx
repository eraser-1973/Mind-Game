import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  ratingsComplete: false,
  state: null as Awaited<
    ReturnType<typeof import('../state/gameReducer')['createInitialGameState']>
  > | null,
  setState: null as null | ((complete: boolean, mode?: 'quick' | 'formal') => void),
}))

vi.mock('../state/gameReducer', async () => {
  const actual = await vi.importActual<typeof import('../state/gameReducer')>(
    '../state/gameReducer',
  )
  const buildState = (
    complete: boolean,
    mode: 'quick' | 'formal' = 'quick',
  ) => {
    const formalResearch =
      mode === 'formal'
        ? {
            participantId: '11111111-1111-4111-8111-111111111111',
            formalSession: {
              participantId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              configSetId: 'config-2026-07-v1',
              versions: {
                task: 'task-1.0.0',
                material: 'material-1.0.0',
                pointRule: 'points-5-v1',
                scoring: 'RDI-2.0-prepilot',
                benchmark: 'benchmark-1.0.0',
                norm: null,
              },
              candidateDisplayOrder: ['D', 'B', 'E', 'A', 'C'] as [
                'D',
                'B',
                'E',
                'A',
                'C',
              ],
              initialOpenedCandidate: 'D' as const,
              currentStep: 'game_ready' as const,
              createdAt: '2026-07-31T00:00:00.000Z',
            },
            consent: { accepted: true, acceptedAt: '2026-07-31T00:00:00.000Z' },
            demographics: null,
            preTask: null,
            postTask: null,
            taskExperience: null,
            startedAt: '2026-07-31T00:00:00.000Z',
            completedAt: null,
          }
        : null
    const state = actual.createInitialGameState(mode, 1_000, formalResearch)

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
  mockState.setState = (
    complete: boolean,
    mode: 'quick' | 'formal' = 'quick',
  ) => {
    mockState.ratingsComplete = complete
    mockState.state = buildState(complete, mode)
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

vi.mock('./NikoChatPanel', () => ({
  NikoChatPanel: () => <div>NikoChatPanel</div>,
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

vi.mock('./FormalGameScreen', () => ({
  FormalGameScreen: () => <div>FormalGameScreen</div>,
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

  it('routes an authenticated formal session to the server-backed T1 screen and keeps quick local', () => {
    mockState.setState?.(true, 'formal')
    const formal = renderToStaticMarkup(
      <GameScreen
        mode="formal"
        researchData={mockState.state?.researchData}
        onRestart={() => undefined}
      />,
    )

    mockState.setState?.(true, 'quick')
    const quick = renderToStaticMarkup(
      <GameScreen mode="quick" onRestart={() => undefined} />,
    )

    expect(formal).toContain('FormalGameScreen')
    expect(formal).not.toContain('NikoChatPanel')
    expect(quick).toContain('HRChatPanel')
    expect(quick).not.toContain('NikoChatPanel')
  })
})
