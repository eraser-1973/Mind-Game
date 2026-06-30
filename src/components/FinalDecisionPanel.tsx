import type {
  Candidate,
  CandidateRuntimeState,
} from '../types/game'

type Props = {
  candidates: Candidate[]
  runtime: Record<string, CandidateRuntimeState>
  timeExpired: boolean
  onSelect: (id: string) => void
  onBack: () => void
}

export function FinalDecisionPanel({
  candidates,
  runtime,
  timeExpired,
  onSelect,
  onBack,
}: Props) {
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
            const stages = ['T1', 'T2', 'T3'].filter(
              (stage) => item.ratings[stage as 'T1' | 'T2' | 'T3'],
            )
            return (
              <button
                key={candidate.id}
                className="decision-card"
                onClick={() => onSelect(candidate.id)}
              >
                <span className="terminal-id">终端 {candidate.id}</span>
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
        {!timeExpired && (
          <button className="text-button" onClick={onBack}>
            返回继续查证
          </button>
        )}
      </section>
    </div>
  )
}
