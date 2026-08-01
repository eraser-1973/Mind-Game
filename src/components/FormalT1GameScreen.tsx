import { useMemo, useState } from 'react'
import { candidateById } from '../data/candidates'
import { useFormalGameController } from '../hooks/useFormalGameController'
import type { FormalGameSnapshot } from '../types/formalGame'
import type { Candidate, CandidateRuntimeState, FormalSessionContext, PublicCandidateId } from '../types/game'
import { CandidateList } from './CandidateList'
import { FormalCandidateDetail } from './FormalCandidateDetail'
import { FormalT1CompletePanel } from './FormalT1CompletePanel'
import { HRChatPanel } from './HRChatPanel'
import { StageChoicePanel } from './StageChoicePanel'
import { TimerBar } from './TimerBar'

function runtimeFromSnapshot(snapshot: FormalGameSnapshot): Record<string, CandidateRuntimeState> {
  return Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((candidateId) => {
    const rating = snapshot.ratings.find((item) => item.candidateId === candidateId)
    return [candidateId, {
      candidateId,
      ratings: rating ? { T1: { value: rating.ratingValue, elapsedSec: 900 - snapshot.remainingSec } } : {},
      spentPoints: 0,
      shallowCount: 0,
      deepCount: 0,
      shallowUnlocked: false,
      deepUnlocked: false,
      negativeEvidenceSeen: false,
      addedAfterNegative: false,
      viewTimeMs: 0,
    }]
  }))
}

export function FormalT1GameScreen({
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
  const orderedCandidates = useMemo(() => session.candidateDisplayOrder
    .map((candidateId) => candidateById[candidateId])
    .filter((candidate): candidate is Candidate => Boolean(candidate)), [session.candidateDisplayOrder])

  if (!controller.snapshot) {
    return (
      <main className="research-screen" data-testid={controller.startError ? 'formal-game-start-error' : 'formal-game-starting'}>
        <section className="research-card">
          <span className="eyebrow">FORMAL GAME SESSION</span>
          <h1>{controller.startError ? '\u6682\u65f6\u65e0\u6cd5\u521b\u5efa\u5b9e\u9a8c\u6e38\u620f' : '\u6b63\u5728\u542f\u52a8\u670d\u52a1\u5668\u8ba1\u65f6'}</h1>
          <p className="research-card__lead">{controller.startError ?? '\u5012\u8ba1\u65f6\u5c06\u4ee5\u670d\u52a1\u5668\u786e\u8ba4\u7684\u542f\u52a8\u65f6\u95f4\u4e3a\u51c6\u3002'}</p>
          <div className="research-actions">
            <button className="button button--ghost" onClick={onExit}>{'\u8fd4\u56de\u5165\u53e3'}</button>
            {controller.startError && <button className="button button--primary" data-testid="retry-formal-game-start" onClick={controller.retryStart}>{'\u91cd\u8bd5'}</button>}
          </div>
        </section>
      </main>
    )
  }

  if (controller.snapshot.currentStage === 'T1_COMPLETE') return <FormalT1CompletePanel />
  if (controller.expired) return <FormalT1CompletePanel expired />

  const elapsedSec = 900 - controller.remainingSec
  if (controller.snapshot.ratings.length === 5) {
    return (
      <main className="game-screen formal-stage-screen">
        <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={5} mode="formal" />
        <StageChoicePanel
          candidates={orderedCandidates}
          pending={controller.choicePending}
          error={controller.choiceError}
          onSubmit={(candidateId, confidence) => void controller.submitChoice(candidateId, confidence)}
        />
      </main>
    )
  }

  const runtime = runtimeFromSnapshot(controller.snapshot)
  const selected = candidateById[selectedId]
  const rating = controller.snapshot.ratings.find((item) => item.candidateId === selectedId)
  return (
    <main className="game-screen" data-testid="formal-t1-game">
      <TimerBar timeLeftSec={controller.remainingSec} durationSec={900} elapsedSec={elapsedSec} availablePoints={5} mode="formal" />
      <div className="game-layout">
        <CandidateList candidates={orderedCandidates} runtime={runtime} selectedId={selectedId} onSelect={(id) => setSelectedId(id as PublicCandidateId)} />
        <FormalCandidateDetail
          candidate={selected}
          rating={rating}
          pending={controller.pendingRatingId === selectedId}
          expired={controller.expired}
          error={controller.ratingError[selectedId]}
          onSubmit={(value) => void controller.submitRating(selectedId, value)}
        />
        <div className="feedback-rail"><HRChatPanel chats={[]} elapsedSec={elapsedSec} /></div>
      </div>
      <footer className="action-dock">
        <div><span className="eyebrow">{'\u5f53\u524d\u4efb\u52a1'}</span><strong>{`\u5b8c\u6210\u4e94\u540d\u5019\u9009\u4eba\u7684 T1 \u521d\u8bc4\uff08${controller.snapshot.ratings.length}/5\uff09`}</strong></div>
        <button className="button button--primary button--compact" disabled>{'\u67e5\u8bc1\u9636\u6bb5\u672a\u5f00\u653e'}</button>
      </footer>
    </main>
  )
}
