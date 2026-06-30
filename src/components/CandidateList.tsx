import type {
  Candidate,
  CandidateRuntimeState,
} from '../types/game'

type Props = {
  candidates: Candidate[]
  runtime: Record<string, CandidateRuntimeState>
  selectedId: string
  onSelect: (id: string) => void
}

export function CandidateList({
  candidates,
  runtime,
  selectedId,
  onSelect,
}: Props) {
  const t1Count = candidates.filter(
    (candidate) => runtime[candidate.id].ratings.T1,
  ).length

  return (
    <aside className="candidate-rail panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">人才雷达</span>
          <h2>候选终端</h2>
        </div>
        <span className="count-badge">{t1Count}/5 初评</span>
      </div>
      <div className="candidate-list">
        {candidates.map((candidate, index) => {
          const item = runtime[candidate.id]
          const evidenceCount =
            Number(item.shallowUnlocked) + Number(item.deepUnlocked)
          return (
            <button
              key={candidate.id}
              className={
                'candidate-card' +
                (selectedId === candidate.id ? ' is-active' : '')
              }
              onClick={() => onSelect(candidate.id)}
              aria-pressed={selectedId === candidate.id}
            >
              <span className="candidate-card__index">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="candidate-card__body">
                <strong>{candidate.name}</strong>
                <small>{candidate.role}</small>
                <span className="candidate-card__meta">
                  {item.ratings.T1 ? 'T1 已封存' : '等待初评'}
                  <i>证据 {evidenceCount}/2</i>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="rail-legend">
        <span><i className="legend-dot legend-dot--rated" /> 已评分</span>
        <span><i className="legend-dot legend-dot--evidence" /> 已查证</span>
      </div>
    </aside>
  )
}
