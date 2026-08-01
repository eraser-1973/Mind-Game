import { useEffect, useState } from 'react'
import type { FormalRating, FormalRatingStage } from '../types/formalGame'
import type { PublicCandidateId } from '../types/game'

export function FormalRatingPanel({
  candidateId,
  stage,
  rating,
  pending,
  expired,
  error,
  onSubmit,
}: {
  candidateId: PublicCandidateId
  stage: FormalRatingStage
  rating?: FormalRating
  pending: boolean
  expired: boolean
  error?: string | null
  onSubmit: (value: number) => void | Promise<unknown>
}) {
  const [value, setValue] = useState(50)
  useEffect(() => setValue(50), [candidateId, stage])

  return (
    <section className="rating-panel formal-rating-panel" data-testid={`formal-rating-${stage}-${candidateId}`}>
      <div className="section-title-row">
        <div><span className="eyebrow">{stage}</span><h3>{stage === 'T2' ? '浅查后重评' : '深查后终评'}</h3></div>
      </div>
      {rating ? <p className="empty-state">{`${stage} ${rating.ratingValue} · 服务器已封存`}</p> : <>
        <div className="rating-control">
          <span>0</span>
          <input
            aria-label={`${stage} ${candidateId}`}
            type="range"
            min="0"
            max="100"
            value={value}
            disabled={pending || expired}
            onChange={(event) => setValue(Number(event.target.value))}
          />
          <span>100</span><output>{value}</output>
        </div>
        {error && <p className="formal-game-error" role="alert">{error}</p>}
        <button
          type="button"
          className="button button--compact"
          disabled={pending || expired}
          onClick={() => onSubmit(value)}
        >
          {pending ? '正在保存…' : `提交并封存 ${stage}`}
        </button>
      </>}
    </section>
  )
}
