import type {
  Candidate,
  CandidateRuntimeState,
} from '../types/game'
import { useState } from 'react'
import { formatDisplayedValue } from '../utils/display'

type Props = {
  candidates: Candidate[]
  runtime: Record<string, CandidateRuntimeState>
  timeExpired: boolean
  onSelect: (id: string, confidence: number) => void
  onBack: () => void
}

export function FinalDecisionPanel({
  candidates,
  runtime,
  timeExpired,
  onSelect,
  onBack,
}: Props) {
  const [candidateId, setCandidateId] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  return (
    <div className="modal-backdrop modal-backdrop--decision">
      <section
        className="modal decision-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-title"
      >
        <span className="eyebrow">FINAL DECISION</span>
        <h2 id="decision-title">
          {timeExpired ? '时间到：提交最终人选' : '锁定最终录用者'}
        </h2>
        <p>
          真实能力将在提交后揭示。此处只显示你已经完成的判断阶段和资源投入，不回显历史分数。
        </p>
        <div className="decision-grid">
          {candidates.map((candidate) => {
            const item = runtime[candidate.id]
            const isSelected = candidateId === candidate.id
            const stages = ['T1', 'T2', 'T3'].filter(
              (stage) => item.ratings[stage as 'T1' | 'T2' | 'T3'],
            )
            return (
              <button
                key={candidate.id}
                type="button"
                className={`decision-card decision-candidate-card${isSelected ? ' is-selected' : ''}`}
                aria-label={`选择候选人 ${candidate.id} ${candidate.name}`}
                aria-pressed={isSelected}
                onClick={() => setCandidateId(candidate.id)}
              >
                <span className="terminal-id">终端 {candidate.id}</span>
                <span className="decision-card__selection" aria-hidden="true">
                  ✓ 已选择
                </span>
                <strong>{candidate.name}</strong>
                <small>{candidate.role}</small>
                <div>
                  <span>{stages.join(' / ')} 已封存</span>
                  <span>投入 {item.spentPoints} 点</span>
                </div>
              </button>
            )
          })}
        </div>
        <label className="rating-control">最终决策信心 0–100
          <input aria-label="最终决策信心" type="range" min="0" max="100" value={confidence ?? 50} onChange={(event) => setConfidence(Number(event.target.value))} />
          <output>{formatDisplayedValue(confidence)}</output>
        </label>
        <button type="button" className="button button--primary" disabled={!candidateId || confidence === null} onClick={() => candidateId && confidence !== null && onSelect(candidateId, confidence)}>{timeExpired ? '确认超时决策' : '提交最终录用'}</button>
        {!timeExpired && (
          <button className="text-button" onClick={onBack}>
            返回继续查证
          </button>
        )}
      </section>
    </div>
  )
}
