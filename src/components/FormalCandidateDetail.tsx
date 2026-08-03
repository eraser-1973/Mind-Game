import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { FormalRating } from '../types/formalGame'
import type { PublicCandidateProfile } from '../types/game'

export function FormalCandidateDetail({
  candidate,
  rating,
  pending,
  expired,
  error,
  onSubmit,
  children,
}: {
  candidate: PublicCandidateProfile
  rating?: FormalRating
  pending?: boolean
  expired?: boolean
  error?: string | null
  onSubmit?: (value: number) => void
  children?: ReactNode
}) {
  const [value, setValue] = useState(50)

  useEffect(() => setValue(50), [candidate.id])

  return (
    <article className="candidate-detail panel">
      <header className="profile-header">
        <div className="avatar-mark">{candidate.name.slice(-1)}</div>
        <div>
          <span className="terminal-id">TERMINAL / {candidate.id}</span>
          <h2>{candidate.name}</h2>
          <p>{candidate.role} · {candidate.school}</p>
        </div>
        <div className="profile-status"><span>T1</span><strong>{rating ? '\u5df2\u5c01\u5b58' : '\u5f85\u8bc4\u5206'}</strong></div>
      </header>
      <div className="halo-row">{candidate.visibleHalo.map((halo) => <span key={halo}>{halo}</span>)}</div>
      <section className="resume-block">
        <span className="eyebrow">{'\u7b80\u5386\u6458\u8981'}</span>
        <p>{candidate.resumeSummary}</p>
        <p className="resume-block__education">{candidate.education}</p>
        <div className="tag-row">{candidate.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
        <div className="experience-list">
          {candidate.experiences.map((experience) => <article key={experience.title}><strong>{experience.title}</strong><p>{experience.content}</p></article>)}
        </div>
      </section>
      {children ?? <>
        <section className="formal-verification-lock" data-testid="formal-verification-locked">
          <span className="eyebrow">EVIDENCE LOCKED</span>
          <strong>{'完成全部 T1 初评后开放服务器查证'}</strong>
          <p>{'正式模式不会在本地预先显示材料或扣减查证点数。'}</p>
        </section>
        <section className="rating-panel" data-testid={`formal-rating-${candidate.id}`}>
        <div className="section-title-row"><div><span className="eyebrow">T1</span><h3>{'\u7b80\u5386\u9996\u5c4f\u521d\u8bc4'}</h3></div></div>
        {rating ? (
          <p className="empty-state">{`T1 ${rating.ratingValue} · \u670d\u52a1\u5668\u5df2\u5c01\u5b58`}</p>
        ) : (
          <>
            <div className="rating-control">
              <span>0</span>
              <input aria-label={`T1 ${candidate.id}`} type="range" min="0" max="100" value={value} disabled={pending || expired} onChange={(event) => setValue(Number(event.target.value))} />
              <span>100</span><output>{value}</output>
            </div>
            {error && <p className="formal-game-error" role="alert">{error}</p>}
            <button type="button" className="button button--compact" disabled={pending || expired} onClick={() => onSubmit?.(value)}>
              {pending ? '\u6b63\u5728\u4fdd\u5b58\u2026' : '\u63d0\u4ea4\u5e76\u5c01\u5b58 T1'}
            </button>
          </>
        )}
        </section>
      </>}
    </article>
  )
}
