import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { candidates, candidateById } from '../data/candidates'
import {
  allT1Rated,
  createInitialGameState,
  gameReducer,
} from '../state/gameReducer'
import type {
  Candidate,
  GameMode,
  GameState,
  ResearchData,
  VerifyType,
} from '../types/game'
import { createSessionEventId } from '../utils/sessionData'
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
import { StageSnapshotModal } from './StageSnapshotModal'

type Props = {
  mode: GameMode
  onRestart: () => void
  researchData?: ResearchData | null
  onGameComplete?: (state: GameState) => void
  initialState?: GameState | null
  onStateChange?: (state: GameState) => void
}

export function GameScreen({
  mode,
  onRestart,
  researchData = null,
  onGameComplete,
  initialState = null,
  onStateChange,
}: Props) {
  const [state, dispatch] = useReducer(
    gameReducer,
    undefined,
    () => initialState ?? createInitialGameState(mode, Date.now(), researchData),
  )
  const completionNotifiedRef = useRef(false)
  const verificationInFlightRef = useRef(false)
  const [pendingVerifyType, setPendingVerifyType] =
    useState<VerifyType | null>(null)

  useEffect(() => { onStateChange?.(state) }, [onStateChange, state])

  const verify = (candidateId: string, verifyType: VerifyType) => {
    if (verificationInFlightRef.current) return
    verificationInFlightRef.current = true
    setPendingVerifyType(verifyType)
    dispatch({
      type: 'VERIFY',
      candidateId,
      verifyType,
      eventId: createSessionEventId(),
      occurredAt: new Date().toISOString(),
    })
    window.setTimeout(() => {
      verificationInFlightRef.current = false
      setPendingVerifyType(null)
    }, 0)
  }

  useEffect(() => {
    if (state.phase !== 'playing') return
    const timer = window.setInterval(
      () => dispatch({ type: 'TICK', deltaSec: 1 }),
      1_000,
    )
    return () => window.clearInterval(timer)
  }, [state.phase])

  const initialRatingsComplete = allT1Rated(state)
  const missingT1Snapshot = initialRatingsComplete && !state.stageSnapshots.some((snapshot) => snapshot.stage === 'T1')
  const showNikoFeedback =
    mode === 'quick' && initialRatingsComplete
  const selected = candidateById[state.selectedCandidateId]
  const orderedCandidates = state.candidateDisplayOrder
    .map((candidateId) => candidateById[candidateId])
    .filter((candidate): candidate is Candidate => Boolean(candidate))
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

  useEffect(() => {
    if (!onGameComplete || state.phase !== 'report') return
    if (completionNotifiedRef.current) return
    completionNotifiedRef.current = true
    onGameComplete(state)
  }, [onGameComplete, state])

  if (report) {
    if (onGameComplete) {
      return (
        <main className="research-screen">
          <section className="research-card">
            <span className="eyebrow">ANONYMOUS DATA BUFFER</span>
            <h1>正在保存匿名游戏记录…</h1>
            <p className="research-card__lead">
              游戏核心数据已完成封存，即将进入任务后状态评估。
            </p>
          </section>
        </main>
      )
    }
    return (
      <ReportScreen
        report={report}
        sourceState={state}
        onRestart={onRestart}
      />
    )
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
          candidates={orderedCandidates}
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
          investigationLocked={!initialRatingsComplete || missingT1Snapshot}
          mode={state.mode}
          pendingVerifyType={pendingVerifyType}
          onVerify={(verifyType) => verify(selected.id, verifyType)}
          onRate={(stage, value) =>
            dispatch({
              type: 'RATE',
              candidateId: selected.id,
              stage,
              value,
              eventId: createSessionEventId(),
              occurredAt: new Date().toISOString(),
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
            dispatch({ type: 'SUNK_COST_CHOICE', choice, eventId: createSessionEventId(), occurredAt: new Date().toISOString() })
          }
        />
      )}

      {state.phase === 'decision' && (
        <FinalDecisionPanel
          candidates={orderedCandidates}
          runtime={state.runtime}
          timeExpired={state.timeLeftSec === 0}
          onSelect={(candidateId, confidence) =>
            dispatch({
              type: 'FINAL_SELECT',
              candidateId,
              confidence,
              submissionType: state.timeLeftSec === 0 ? 'timeout_confirmed' : 'manual',
              eventId: createSessionEventId(),
              occurredAt: new Date().toISOString(),
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

      {(missingT1Snapshot || state.pendingSnapshotStage) && (
        <StageSnapshotModal
          stage={missingT1Snapshot ? 'T1' : state.pendingSnapshotStage!}
          candidates={orderedCandidates}
          onSubmit={(candidateId, confidence) => dispatch({ type: 'CAPTURE_STAGE_SNAPSHOT', stage: missingT1Snapshot ? 'T1' : state.pendingSnapshotStage!, preferredCandidateId: candidateId, confidence, eventId: createSessionEventId(), occurredAt: new Date().toISOString() })}
        />
      )}
    </main>
  )
}
