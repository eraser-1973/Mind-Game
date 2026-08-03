import type { PublicCandidateId, PublicCandidateProfile } from '../types/game'

export function FormalFinalDecisionPanel({
  candidates, selectedId, confidence, confidenceTouched, canSubmit, pending, error,
  onSelect, onConfidenceChange, onSubmit, onBack,
}: {
  candidates: PublicCandidateProfile[]
  selectedId: PublicCandidateId | null
  confidence: number
  confidenceTouched: boolean
  canSubmit: boolean
  pending: boolean
  error: string | null
  title?: string
  onSelect: (candidateId: PublicCandidateId) => void
  onConfidenceChange: (value: number) => void
  onSubmit: () => void
  onBack?: () => void
}) {
  return (
    <main className="game-screen formal-stage-screen" data-testid="formal-final-decision">
      <section className="modal decision-modal formal-final-panel">
        <span className="eyebrow">FINAL DECISION</span>
        <h2>锁定最终录用人选</h2>
        <p>请根据本轮已查看的信息选择一名候选人，并主动确认此刻的决策信心。</p>
        <div className="decision-grid">
          {candidates.map((candidate) => {
            const selected = selectedId === candidate.id
            return (
              <button key={candidate.id} type="button"
                className={`decision-card${selected ? ' decision-card--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(candidate.id as PublicCandidateId)}>
                <span className="terminal-id">候选人 {candidate.id}</span>
                <strong>{candidate.name}</strong><small>{candidate.role}</small>
                {selected && <span className="decision-card__selected">已选择</span>}
              </button>
            )
          })}
        </div>
        <label className="formal-final-confidence">
          <span>最终决策信心</span>
          <input type="range" min="0" max="100" step="1" value={confidence}
            onPointerDown={() => {
              if (!confidenceTouched) onConfidenceChange(confidence)
            }}
            onKeyDown={() => {
              if (!confidenceTouched) onConfidenceChange(confidence)
            }}
            onChange={(event) => onConfidenceChange(Number(event.target.value))} />
          <output>{confidenceTouched ? confidence : 0}</output>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="research-actions">
          {onBack && <button className="button button--ghost" disabled={pending} onClick={onBack}>返回继续查证</button>}
          <button className="button button--primary" data-testid="submit-formal-final"
            disabled={!canSubmit || pending} onClick={onSubmit}>提交最终录用</button>
        </div>
      </section>
    </main>
  )
}
