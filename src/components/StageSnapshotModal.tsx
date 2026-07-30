import { useState } from 'react'
import type { Candidate, RatingStage } from '../types/game'
import { formatDisplayedValue } from '../utils/display'

type Props = {
  stage: RatingStage
  candidates: Candidate[]
  onSubmit: (candidateId: string, confidence: number) => void
}

export function StageSnapshotModal({ stage, candidates, onSubmit }: Props) {
  const [candidateId, setCandidateId] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  return (
    <div className="modal-backdrop">
      <section className="modal decision-modal" role="dialog" aria-modal="true">
        <span className="eyebrow">{stage} DECISION SNAPSHOT</span>
        <h2>记录当前首选与决策信心</h2>
        <p>该记录只保存你此刻的判断，不提示候选人优劣。</p>
        <div className="decision-grid">
          {candidates.map((candidate) => {
            const isSelected = candidateId === candidate.id
            return (
              <button
                key={candidate.id}
                type="button"
                className={`decision-card decision-candidate-card${isSelected ? ' is-selected' : ''}`}
                aria-label={`选择候选人 ${candidate.id} ${candidate.name}`}
                aria-pressed={isSelected}
                onClick={() => setCandidateId(candidate.id)}
              >
                <span>{candidate.id}</span>
                <span className="decision-card__selection" aria-hidden="true">
                  ✓ 已选择
                </span>
                <strong>{candidate.name}</strong>
                <small>{candidate.role}</small>
              </button>
            )
          })}
        </div>
        <label className="rating-control">
          决策信心 0–100
          <input
            aria-label={`${stage} 决策信心`}
            type="range"
            min="0"
            max="100"
            value={confidence ?? 50}
            onChange={(event) => setConfidence(Number(event.target.value))}
          />
          <output>{formatDisplayedValue(confidence)}</output>
        </label>
        <button
          type="button"
          className="button button--primary"
          disabled={!candidateId || confidence === null}
          onClick={() =>
            candidateId && confidence !== null && onSubmit(candidateId, confidence)
          }
        >
          提交阶段判断
        </button>
      </section>
    </div>
  )
}
