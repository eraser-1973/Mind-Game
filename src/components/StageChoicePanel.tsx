import { useState } from 'react'
import type { Candidate, PublicCandidateId } from '../types/game'

export function StageChoicePanel({
  candidates,
  pending,
  error,
  onSubmit,
}: {
  candidates: Candidate[]
  pending: boolean
  error?: string | null
  onSubmit: (candidateId: PublicCandidateId, confidence: number) => void
}) {
  const [selectedId, setSelectedId] = useState<PublicCandidateId | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [confidenceTouched, setConfidenceTouched] = useState(false)
  const canSubmit = selectedId !== null && confidenceTouched && !pending

  return (
    <section className="formal-stage-choice panel" data-testid="formal-t1-stage-choice">
      <span className="eyebrow">T1 DECISION SNAPSHOT</span>
      <h2>{'\u8bb0\u5f55\u5f53\u524d\u9996\u9009\u4e0e\u51b3\u7b56\u4fe1\u5fc3'}</h2>
      <p>{'\u4e94\u4efd\u521d\u8bc4\u5df2\u5c01\u5b58\u3002\u8bf7\u6839\u636e\u5f53\u524d\u4fe1\u606f\u4f5c\u51fa\u9636\u6bb5\u6027\u9009\u62e9\uff0c\u6b64\u5904\u4e0d\u8868\u793a\u6b63\u786e\u7b54\u6848\u3002'}</p>
      <div className="decision-grid formal-stage-choice__grid">
        {candidates.map((candidate) => {
          const selected = selectedId === candidate.id
          return (
            <button
              key={candidate.id}
              type="button"
              data-candidate-id={candidate.id}
              className={`decision-card${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => setSelectedId(candidate.id as PublicCandidateId)}
              disabled={pending}
            >
              <span>{candidate.id}</span>
              <strong>{candidate.name}</strong>
              <small>{candidate.role}</small>
              {selected && <i>{'\u5df2\u9009\u62e9'}</i>}
            </button>
          )
        })}
      </div>
      <div className="formal-stage-choice__confidence">
        <label htmlFor="t1-stage-confidence">{'\u5f53\u524d\u51b3\u7b56\u4fe1\u5fc3'}</label>
        <div className="rating-control">
          <span>0</span>
          <input
            id="t1-stage-confidence"
            data-testid="t1-confidence"
            data-touched={String(confidenceTouched)}
            type="range"
            min="0"
            max="100"
            value={confidence}
            onChange={(event) => {
              setConfidence(Number(event.target.value))
              setConfidenceTouched(true)
            }}
          />
          <span>100</span>
          <output data-testid="t1-confidence-value">{confidence}</output>
        </div>
      </div>
      {error && <p className="formal-game-error" role="alert">{error}</p>}
      <button
        type="button"
        className="button button--primary"
        data-testid="submit-t1-stage-choice"
        disabled={!canSubmit}
        onClick={() => {
          if (selectedId) onSubmit(selectedId, confidence)
        }}
      >
        {pending ? '\u6b63\u5728\u5c01\u5b58\u2026' : '\u63d0\u4ea4 T1 \u9636\u6bb5\u5224\u65ad'}
      </button>
    </section>
  )
}
