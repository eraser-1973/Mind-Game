import { useMemo, useState } from 'react'
import { candidateById } from '../data/candidates'
import { useFormalGameController } from '../hooks/useFormalGameController'
import type {
  FormalEvidenceLevel,
  FormalGameSnapshot,
  FormalRatingStage,
} from '../types/formalGame'
import type {
  Candidate,
  CandidateRuntimeState,
  FormalSessionContext,
  NikoMessage,
  PublicCandidateId,
} from '../types/game'
import { createNikoFeedbackFromEvidence } from '../utils/nikoFeedback'
import { CandidateList } from './CandidateList'
import { FormalCandidateDetail } from './FormalCandidateDetail'
import { FormalEvidencePanel } from './FormalEvidencePanel'
import { FormalRatingPanel } from './FormalRatingPanel'
import { FormalSunkCostModal } from './FormalSunkCostModal'
import { FormalFinalDecisionPanel } from './FormalFinalDecisionPanel'
import { FormalPostTaskPause } from './FormalPostTaskPause'
import { HRChatPanel } from './HRChatPanel'
import { NikoChatPanel } from './NikoChatPanel'
import { StageChoicePanel } from './StageChoicePanel'
import { TimerBar } from './TimerBar'

function runtimeFromSnapshot(snapshot: FormalGameSnapshot): Record<string, CandidateRuntimeState> {
  return Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((candidateId) => {
    const ratings = Object.fromEntries(snapshot.ratings
      .filter((item) => item.candidateId === candidateId)
      .map((item) => [item.stage, {
        value: item.ratingValue,
        elapsedSec: Math.max(0, 900 - snapshot.remainingSec),
      }]))
    const unlocks = snapshot.evidenceUnlocks.filter((item) => item.candidateId === candidateId)
    const shallow = unlocks.find((item) => item.level === 'shallow')
    const deep = unlocks.find((item) => item.level === 'deep')
    return [candidateId, {
      candidateId,
      ratings,
      spentPoints: unlocks.reduce((total, unlock) => total + unlock.points.cost, 0),
      shallowCount: shallow ? 1 : 0,
      deepCount: deep ? 1 : 0,
      shallowUnlocked: Boolean(shallow),
      deepUnlocked: Boolean(deep),
      negativeEvidenceSeen: false,
      addedAfterNegative: false,
      viewTimeMs: 0,
    }]
  }))
}

export function FormalGameScreen({
  session,
  initialSnapshot,
  onSnapshot,
  onExit,
}: {
  session: FormalSessionContext
  initialSnapshot?: FormalGameSnapshot | null
  onSnapshot?: (snapshot: FormalGameSnapshot) => void
  onExit: () => void
}) {
  const controller = useFormalGameController({ session, initialSnapshot, onSnapshot })
  const [selectedId, setSelectedId] = useState<PublicCandidateId>(session.initialOpenedCandidate)
  const [nikoMessages, setNikoMessages] = useState<NikoMessage[]>([])
  const [showFinalDecision, setShowFinalDecision] = useState(false)
  const [finalCandidateId, setFinalCandidateId] = useState<PublicCandidateId | null>(null)
  const [finalConfidence, setFinalConfidence] = useState(0)
  const [finalConfidenceTouched, setFinalConfidenceTouched] = useState(false)
  const orderedCandidates = useMemo(() => session.candidateDisplayOrder
    .map((candidateId) => candidateById[candidateId])
    .filter((candidate): candidate is Candidate => Boolean(candidate)), [session.candidateDisplayOrder])

  if (!controller.snapshot) {
    return (
      <main className="research-screen" data-testid={controller.startError ? 'formal-game-start-error' : 'formal-game-starting'}>
        <section className="research-card">
          <span className="eyebrow">FORMAL GAME SESSION</span>
          <h1>{controller.startError ? '暂时无法创建实验游戏' : '正在启动服务器计时'}</h1>
          <p className="research-card__lead">{controller.startError ?? '倒计时将以服务器确认的启动时间为准。'}</p>
          <div className="research-actions">
            <button className="button button--ghost" onClick={onExit}>返回入口</button>
            {controller.startError && <button className="button button--primary" data-testid="retry-formal-game-start" onClick={controller.retryStart}>重试</button>}
          </div>
        </section>
      </main>
    )
  }

  const snapshot = controller.snapshot
  const elapsedSec = 900 - controller.remainingSec
  const t1Ratings = snapshot.ratings.filter(({ stage }) => stage === 'T1')

  if (controller.finalDecision) {
    return <FormalPostTaskPause submitMode={controller.finalDecision.submitMode} />
  }

  if (controller.sunkCost?.required && controller.sunkCost.targetCandidateId) {
    const target = candidateById[controller.sunkCost.targetCandidateId]
    return (
      <main className="game-screen" data-testid="formal-sunk-cost-gate">
        <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={snapshot.points.remaining} mode="formal" />
        <FormalSunkCostModal
          candidate={target}
          pointsInvested={controller.sunkCost.pointsInvestedBefore ?? 0}
          pending={controller.stage6Pending === 'choice'}
          error={controller.stage6Error}
          onChoose={(choice) => void controller.submitSunkChoice(choice)}
        />
      </main>
    )
  }

  if (controller.expired) {
    return (
      <main className="research-screen" data-testid="formal-timeout-saving">
        <section className="research-card"><span className="eyebrow">TIME EXPIRED</span>
          <h1>正在安全封存本轮结果</h1>
          <p className="research-card__lead">服务器将依据最近一次已封存的阶段选择记录超时结果。</p>
          {controller.stage6Error && <p className="form-error">{controller.stage6Error}</p>}
        </section>
      </main>
    )
  }

  if (snapshot.currentStage === 'T1' && t1Ratings.length === 5) {
    return (
      <main className="game-screen formal-stage-screen">
        <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={snapshot.points.remaining} mode="formal" />
        <StageChoicePanel
          candidates={orderedCandidates}
          stage="T1"
          pending={controller.choicePending}
          error={controller.choiceError}
          onSubmit={(candidateId, confidence) => void controller.submitChoice('T1', candidateId, confidence)}
        />
      </main>
    )
  }

  if (snapshot.currentStage === 'T1') {
    const runtime = runtimeFromSnapshot(snapshot)
    const selected = candidateById[selectedId]
    const rating = snapshot.ratings.find((item) => item.candidateId === selectedId && item.stage === 'T1')
    return (
      <main className="game-screen" data-testid="formal-t1-game">
        <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={snapshot.points.remaining} mode="formal" />
        <div className="game-layout">
          <CandidateList candidates={orderedCandidates} runtime={runtime} selectedId={selectedId} onSelect={(id) => setSelectedId(id as PublicCandidateId)} />
          <FormalCandidateDetail
            candidate={selected}
            rating={rating}
            pending={controller.pendingRating === `T1:${selectedId}`}
            expired={controller.expired}
            error={controller.operationErrors[`T1:${selectedId}`]}
            onSubmit={(value) => void controller.submitRating(selectedId, 'T1', value)}
          />
          <div className="feedback-rail"><HRChatPanel chats={[]} elapsedSec={elapsedSec} /></div>
        </div>
        <footer className="action-dock">
          <div><span className="eyebrow">当前任务</span><strong>{`完成五名候选人的 T1 初评（${t1Ratings.length}/5）`}</strong></div>
          <button className="button button--primary button--compact" disabled>完成初评后开放查证</button>
        </footer>
      </main>
    )
  }

  const mustDecide = snapshot.stageStatus === 'T3_COMPLETE' ||
    snapshot.stageStatus === 'DECISION_COMPLETE' ||
    (snapshot.stageStatus === 'T2_COMPLETE' && snapshot.points.remaining < 3)
  if (mustDecide || showFinalDecision) {
    const canSubmit = finalCandidateId !== null && finalConfidenceTouched &&
      controller.stage6Pending !== 'final'
    return (
      <FormalFinalDecisionPanel
        title="锁定最终录用人选"
        candidates={orderedCandidates}
        selectedId={finalCandidateId}
        confidence={finalConfidence}
        confidenceTouched={finalConfidenceTouched}
        canSubmit={canSubmit}
        pending={controller.stage6Pending === 'final'}
        error={controller.stage6Error}
        onSelect={setFinalCandidateId}
        onConfidenceChange={(value) => { setFinalConfidence(value); setFinalConfidenceTouched(true) }}
        onSubmit={() => {
          if (finalCandidateId && finalConfidenceTouched) {
            void controller.submitFinal(finalCandidateId, finalConfidence)
          }
        }}
        onBack={mustDecide ? undefined : () => setShowFinalDecision(false)}
      />
    )
  }

  const shallowUnlocks = snapshot.evidenceUnlocks.filter(({ level }) => level === 'shallow')
  const deepUnlocks = snapshot.evidenceUnlocks.filter(({ level }) => level === 'deep')
  const t2Ready = shallowUnlocks.length > 0 && shallowUnlocks.every(({ candidateId }) =>
    snapshot.ratings.some((rating) => rating.candidateId === candidateId && rating.stage === 'T2'))
  const t3Ready = deepUnlocks.length > 0 && deepUnlocks.every(({ candidateId }) =>
    snapshot.ratings.some((rating) => rating.candidateId === candidateId && rating.stage === 'T3'))

  if (snapshot.stageStatus === 'T2_ACTIVE' && t2Ready) {
    return (
      <main className="game-screen formal-stage-screen">
        <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={snapshot.points.remaining} mode="formal" />
        <StageChoicePanel
          candidates={orderedCandidates}
          stage="T2"
          title="证据初步核验后的选择"
          description="请根据当前已解锁材料，记录此刻的首选候选人与决策信心。"
          submitHint="提交后将结束浅度查证阶段，不能继续浅查或修改 T2。"
          pending={controller.choicePending}
          disabled={controller.expired}
          error={controller.choiceError}
          onSubmit={(candidateId, confidence) => void controller.submitChoice('T2', candidateId, confidence)}
        />
      </main>
    )
  }

  if (snapshot.stageStatus === 'T3_ACTIVE' && t3Ready) {
    return (
      <main className="game-screen formal-stage-screen">
        <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={snapshot.points.remaining} mode="formal" />
        <StageChoicePanel
          candidates={orderedCandidates}
          stage="T3"
          title="深度核验后的选择"
          description="请根据深度核验材料，记录此刻的首选候选人与决策信心。"
          submitHint="提交后将封存深度查证阶段，不能继续深查或修改 T3。"
          pending={controller.choicePending}
          disabled={controller.expired}
          error={controller.choiceError}
          onSubmit={(candidateId, confidence) => void controller.submitChoice('T3', candidateId, confidence)}
        />
      </main>
    )
  }

  const runtime = runtimeFromSnapshot(snapshot)
  const selected = candidateById[selectedId]
  const shallowUnlock = shallowUnlocks.find(({ candidateId }) => candidateId === selectedId)
  const deepUnlock = deepUnlocks.find(({ candidateId }) => candidateId === selectedId)
  const t2Rating = snapshot.ratings.find((item) => item.candidateId === selectedId && item.stage === 'T2')
  const t3Rating = snapshot.ratings.find((item) => item.candidateId === selectedId && item.stage === 'T3')
  const selectedT1Rating = snapshot.ratings.find((item) => item.candidateId === selectedId && item.stage === 'T1')
  const t2ChoiceSaved = snapshot.stageChoices.some(({ stage }) => stage === 'T2')
  const t3ChoiceSaved = snapshot.stageChoices.some(({ stage }) => stage === 'T3')
  const canUnlockShallow = !shallowUnlock && !t2ChoiceSaved &&
    (snapshot.stageStatus === 'T1_COMPLETE' || snapshot.stageStatus === 'T2_ACTIVE') &&
    snapshot.points.remaining >= 1
  const canUnlockDeep = !deepUnlock && t2ChoiceSaved && !t3ChoiceSaved &&
    Boolean(shallowUnlock && t2Rating) &&
    (snapshot.stageStatus === 'T2_COMPLETE' || snapshot.stageStatus === 'T3_ACTIVE') &&
    snapshot.points.remaining >= 3
  const pendingEvidence = controller.pendingEvidence?.endsWith(`:${selectedId}`)
    ? controller.pendingEvidence.split(':')[0] as FormalEvidenceLevel
    : null
  const currentRatingStage: FormalRatingStage | null = deepUnlock && !t3ChoiceSaved
    ? 'T3'
    : shallowUnlock && !t2ChoiceSaved ? 'T2' : null

  const handleRating = async (stage: 'T2' | 'T3', value: number) => {
    const baseline = snapshot.ratings.find((rating) =>
      rating.candidateId === selectedId && rating.stage === (stage === 'T2' ? 'T1' : 'T2'))
    const unlock = stage === 'T2' ? shallowUnlock : deepUnlock
    const result = await controller.submitRating(selectedId, stage, value)
    const evidence = unlock?.evidence[0]
    if (!result || !baseline || !evidence) return
    const message = createNikoFeedbackFromEvidence({
      candidateId: selectedId,
      stage,
      baseline: baseline.ratingValue,
      value: result.ratingValue,
      evidence,
      timestamp: elapsedSec,
    })
    if (message) {
      setNikoMessages((messages) => [
        ...messages.filter((item) => item.id !== message.id),
        message,
      ])
    }
  }

  return (
    <main className="game-screen" data-testid="formal-investigation-game">
      <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={snapshot.points.remaining} mode="formal" />
      <div className="game-layout formal-investigation-layout">
        <CandidateList candidates={orderedCandidates} runtime={runtime} selectedId={selectedId} onSelect={(id) => setSelectedId(id as PublicCandidateId)} />
        <FormalCandidateDetail candidate={selected} rating={selectedT1Rating}>
          <FormalEvidencePanel
            candidateId={selectedId}
            pointsRemaining={snapshot.points.remaining}
            shallowUnlock={shallowUnlock}
            deepUnlock={deepUnlock}
            canUnlockShallow={canUnlockShallow}
            canUnlockDeep={canUnlockDeep}
            pendingLevel={pendingEvidence}
            expired={controller.expired}
            shallowError={controller.operationErrors[`shallow:${selectedId}`]}
            deepError={controller.operationErrors[`deep:${selectedId}`]}
            deepDisabledReason={
              !t2ChoiceSaved ? '提交 T2 阶段选择后开放' :
              !shallowUnlock ? '需先完成该候选人的浅度查证' :
              !t2Rating ? '需先封存该候选人的 T2 评分' :
              snapshot.points.remaining < 3 ? '剩余点数不足 3 点' : null
            }
            onUnlock={(level) => controller.unlockEvidence(selectedId, level)}
          />
          {currentRatingStage && <FormalRatingPanel
            candidateId={selectedId}
            stage={currentRatingStage}
            rating={currentRatingStage === 'T2' ? t2Rating : t3Rating}
            pending={controller.pendingRating === `${currentRatingStage}:${selectedId}`}
            expired={controller.expired}
            error={controller.operationErrors[`${currentRatingStage}:${selectedId}`]}
            onSubmit={(value) => handleRating(currentRatingStage, value)}
          />}
        </FormalCandidateDetail>
        <div className="feedback-rail">
          <HRChatPanel chats={[]} elapsedSec={elapsedSec} />
          <NikoChatPanel messages={nikoMessages} />
        </div>
      </div>
      <footer className="action-dock">
        <div><span className="eyebrow">当前任务</span><strong>可以用查证点数，比较证据并锁定阶段判断。</strong></div>
        <span className="formal-stage-chip">{snapshot.stageStatus}</span>
        {snapshot.stageStatus === 'T2_COMPLETE' && (
          <button className="button button--primary button--compact" onClick={() => setShowFinalDecision(true)}>
            进入最终决策
          </button>
        )}
      </footer>
    </main>
  )
}
