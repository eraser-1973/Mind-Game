import { useEffect, useMemo, useReducer } from 'react'
import { candidates, candidateById } from '../data/candidates'
import {
  allT1Rated,
  createInitialGameState,
  gameReducer,
} from '../state/gameReducer'
import type { GameMode } from '../types/game'
import { createNikoFeedback } from '../utils/nikoFeedback'
import { generateReport } from '../utils/report'
import { CandidateDetail } from './CandidateDetail'
import { CandidateList } from './CandidateList'
import { FinalDecisionPanel } from './FinalDecisionPanel'
import { HRChatPanel } from './HRChatPanel'
import { NikoChatPanel } from './NikoChatPanel'
import { ReportScreen } from './ReportScreen'
import { SunkCostModal } from './SunkCostModal'
import { TimerBar } from './TimerBar'

type Props = {
  mode: GameMode
  onRestart: () => void
}

export function GameScreen({ mode, onRestart }: Props) {
  const [state, dispatch] = useReducer(
    gameReducer,
    mode,
    (initialMode) => createInitialGameState(initialMode),
  )

  useEffect(() => {
    if (state.phase !== 'playing') return
    const timer = window.setInterval(
      () => dispatch({ type: 'TICK', deltaSec: 1 }),
      1_000,
    )
    return () => window.clearInterval(timer)
  }, [state.phase])

  const initialRatingsComplete = allT1Rated(state)
  const showNikoFeedback =
    mode === 'formal' && initialRatingsComplete
  const selected = candidateById[state.selectedCandidateId]
  const toxicFocus = candidates
    .filter((candidate) => candidate.isToxic)
    .sort(
      (a, b) =>
        state.runtime[b.id].spentPoints -
        state.runtime[a.id].spentPoints,
    )[0]
  const report = useMemo(
    () => (state.phase === 'report' ? generateReport(state) : null),
    [state],
  )

  if (report) {
    return <ReportScreen report={report} onRestart={onRestart} />
  }

  return (
    <main className="game-screen">
      <TimerBar
        timeLeftSec={state.timeLeftSec}
        durationSec={state.durationSec}
        elapsedSec={state.elapsedSec}
        availablePoints={state.availablePoints}
        mode={state.mode}
      />

      {state.notice && (
        <button
          className="notice-toast"
          onClick={() => dispatch({ type: 'DISMISS_NOTICE' })}
          aria-label="关闭提示"
        >
          <span>{state.notice}</span>
          <strong>×</strong>
        </button>
      )}

      <div className="game-layout">
        <CandidateList
          candidates={candidates}
          runtime={state.runtime}
          selectedId={state.selectedCandidateId}
          onSelect={(candidateId) =>
            dispatch({
              type: 'SELECT_CANDIDATE',
              candidateId,
              nowMs: Date.now(),
            })
          }
        />
        <CandidateDetail
          candidate={selected}
          runtime={state.runtime[selected.id]}
          availablePoints={state.availablePoints}
          investigationLocked={!initialRatingsComplete}
          onVerify={(verifyType) =>
            dispatch({
              type: 'VERIFY',
              candidateId: selected.id,
              verifyType,
            })
          }
          onRate={(stage, value) =>
            dispatch({
              type: 'RATE',
              candidateId: selected.id,
              stage,
              value,
            })
          }
          onScorePreview={(stage, value) => {
            if (!showNikoFeedback || stage === 'T1') return
            const message = createNikoFeedback({
              candidate: selected,
              runtime: state.runtime[selected.id],
              stage,
              value,
              timestamp: state.elapsedSec,
            })
            if (message) {
              dispatch({ type: 'NIKO_FEEDBACK', message })
            }
          }}
        />
        <div
          className={`feedback-rail${showNikoFeedback ? ' has-niko' : ''}`}
        >
          <HRChatPanel chats={state.chats} elapsedSec={state.elapsedSec} />
          {showNikoFeedback && (
            <NikoChatPanel messages={state.nikoMessages} />
          )}
        </div>
      </div>

      <footer className="action-dock">
        <div>
          <span className="eyebrow">当前任务</span>
          <strong>
            {initialRatingsComplete
              ? '可以用查证点数，比较证据并锁定最终人选。'
              : '完成全部候选人的 T1 初评'}
          </strong>
        </div>
        {mode === 'quick' && state.timeLeftSec > 60 && (
          <button
            className="text-button"
            onClick={() =>
              dispatch({
                type: 'TICK',
                deltaSec: state.timeLeftSec - 60,
              })
            }
          >
            测试：推进到最后 1 分钟
          </button>
        )}
        <button
          className="button button--primary button--compact"
          disabled={!initialRatingsComplete}
          onClick={() => dispatch({ type: 'OPEN_DECISION' })}
        >
          进入最终决策
        </button>
      </footer>

      {state.sunkCostShown && state.sunkCostChoice === null && (
        <SunkCostModal
          candidateName={toxicFocus.name}
          spentPoints={state.runtime[toxicFocus.id].spentPoints}
          onChoose={(choice) =>
            dispatch({ type: 'SUNK_COST_CHOICE', choice })
          }
        />
      )}

      {state.phase === 'decision' && (
        <FinalDecisionPanel
          candidates={candidates}
          runtime={state.runtime}
          timeExpired={state.timeLeftSec === 0}
          onSelect={(candidateId) =>
            dispatch({
              type: 'FINAL_SELECT',
              candidateId,
              nowMs: Date.now(),
            })
          }
          onBack={() => {
            if (state.timeLeftSec > 0) {
              dispatch({ type: 'RESUME_PLAYING' })
            }
          }}
        />
      )}
    </main>
  )
}
