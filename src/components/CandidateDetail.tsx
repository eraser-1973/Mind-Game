import type {
  Candidate,
  CandidateRuntimeState,
  RatingStage,
  VerifyType,
} from '../types/game'
import { RatingPanel } from './RatingPanel'
import { VerifyPanel } from './VerifyPanel'

type Props = {
  candidate: Candidate
  runtime: CandidateRuntimeState
  availablePoints: number
  investigationLocked: boolean
  onVerify: (type: VerifyType) => void
  onRate: (stage: RatingStage, value: number) => void
  onScorePreview?: (stage: RatingStage, value: number) => void
}

export function CandidateDetail({
  candidate,
  runtime,
  availablePoints,
  investigationLocked,
  onVerify,
  onRate,
  onScorePreview,
}: Props) {
  return (
    <article className="candidate-detail panel">
      <header className="profile-header">
        <div className="avatar-mark">{candidate.name.slice(-1)}</div>
        <div>
          <span className="terminal-id">TERMINAL / {candidate.id}</span>
          <h2>{candidate.name}</h2>
          <p>{candidate.role} · {candidate.school}</p>
        </div>
        <div className="profile-status">
          <span>档案可信度</span>
          <strong>待核验</strong>
        </div>
      </header>

      <div className="halo-row">
        {candidate.visibleHalo.map((halo) => (
          <span key={halo}>{halo}</span>
        ))}
      </div>

      <section className="resume-block">
        <span className="eyebrow">简历摘要</span>
        <p>{candidate.resumeSummary}</p>
        <div className="tag-row">
          {candidate.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
      </section>

      <VerifyPanel
        runtime={runtime}
        availablePoints={availablePoints}
        locked={investigationLocked}
        onVerify={onVerify}
      />

      {(runtime.shallowUnlocked || runtime.deepUnlocked) && (
        <section className="evidence-stack" aria-live="polite">
          <div className="section-title-row">
            <div>
              <span className="eyebrow">证据缓存</span>
              <h3>已解锁材料</h3>
            </div>
          </div>
          {runtime.shallowUnlocked && (
            <article className={'evidence-card ' + (candidate.shallowEvidence.isNegative ? 'is-negative' : 'is-positive')}>
              <span>浅度证据</span>
              <strong>{candidate.shallowEvidence.title}</strong>
              <p>{candidate.shallowEvidence.content}</p>
            </article>
          )}
          {runtime.deepUnlocked && (
            <article className={'evidence-card ' + (candidate.deepEvidence.isNegative ? 'is-negative' : 'is-positive')}>
              <span>深度证据</span>
              <strong>{candidate.deepEvidence.title}</strong>
              <p>{candidate.deepEvidence.content}</p>
            </article>
          )}
        </section>
      )}

      <RatingPanel
        candidateId={candidate.id}
      runtime={runtime}
      onRate={onRate}
      onScorePreview={onScorePreview}
    />
    </article>
  )
}
