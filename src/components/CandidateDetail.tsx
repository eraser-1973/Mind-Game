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
  pendingVerifyType?: VerifyType | null
  onVerify: (type: VerifyType) => void
  onRate: (stage: RatingStage, value: number) => void
  onScorePreview?: (stage: RatingStage, value: number) => void
}

export function CandidateDetail({
  candidate,
  runtime,
  availablePoints,
  investigationLocked,
  pendingVerifyType,
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
        <p className="resume-block__education">{candidate.education}</p>
        <div className="tag-row">
          {candidate.skills.map((skill) => <span key={skill}>{skill}</span>)}
        </div>
        <div className="experience-list">
          {candidate.experiences.map((experience) => (
            <article key={experience.title}>
              <strong>{experience.title}</strong>
              <p>{experience.content}</p>
            </article>
          ))}
        </div>
        <div className="tag-row">
          {candidate.tags.map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
      </section>

      <VerifyPanel
        runtime={runtime}
        availablePoints={availablePoints}
        locked={investigationLocked}
        pendingVerifyType={pendingVerifyType}
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
          {runtime.shallowUnlocked && candidate.shallowEvidence.map((evidence, index) => (
            <article key={evidence.id} className={'evidence-card ' + (evidence.isNegative ? 'is-negative' : 'is-positive')}>
              <span>T2 浅度查证 · 材料 {index + 1}</span>
              <strong>{evidence.title}</strong>
              <p>{evidence.content}</p>
            </article>
          ))}
          {runtime.deepUnlocked && candidate.deepEvidence.map((evidence, index) => (
            <article key={evidence.id} className={'evidence-card ' + (evidence.isNegative ? 'is-negative' : 'is-positive')}>
              <span>T3 深度查证 · 材料 {index + 1}</span>
              <strong>{evidence.title}</strong>
              <p>{evidence.content}</p>
            </article>
          ))}
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
