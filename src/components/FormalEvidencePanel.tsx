import type { FormalEvidenceLevel, FormalEvidenceUnlock } from '../types/formalGame'
import type { PublicCandidateId } from '../types/game'

function EvidenceBundle({ unlock }: { unlock: FormalEvidenceUnlock }) {
  return (
    <div className="formal-evidence-bundle" data-testid={`formal-${unlock.level}-evidence`}>
      {unlock.evidence.map((item) => (
        <article className="formal-evidence-card" key={item.id} data-evidence-id={item.id}>
          <span className="eyebrow">MATERIAL {item.order}</span>
          <strong>{item.title}</strong>
          <p>{item.content}</p>
        </article>
      ))}
    </div>
  )
}

export function FormalEvidencePanel({
  candidateId,
  pointsRemaining,
  shallowUnlock,
  deepUnlock,
  canUnlockShallow,
  canUnlockDeep,
  pendingLevel,
  expired,
  shallowError,
  deepError,
  deepDisabledReason,
  onUnlock,
}: {
  candidateId: PublicCandidateId
  pointsRemaining: number
  shallowUnlock?: FormalEvidenceUnlock
  deepUnlock?: FormalEvidenceUnlock
  canUnlockShallow: boolean
  canUnlockDeep: boolean
  pendingLevel: FormalEvidenceLevel | null
  expired: boolean
  shallowError?: string | null
  deepError?: string | null
  deepDisabledReason?: string | null
  onUnlock: (level: FormalEvidenceLevel) => void | Promise<unknown>
}) {
  return (
    <section className="formal-evidence-panel" data-testid={`formal-evidence-${candidateId}`}>
      <div className="section-title-row">
        <div><span className="eyebrow">SERVER EVIDENCE</span><h3>证据资源</h3></div>
        <strong className="formal-points-readout">剩余 {pointsRemaining} 点</strong>
      </div>

      <div className="formal-evidence-action">
        <div><strong>浅度查证</strong><small>服务器扣除 1 点并返回本候选人的 T2 材料</small></div>
        {shallowUnlock ? <span className="formal-sealed-mark">已解锁</span> : (
          <button
            type="button"
            className="button button--compact"
            disabled={!canUnlockShallow || pendingLevel !== null || expired}
            onClick={() => onUnlock('shallow')}
          >
            {pendingLevel === 'shallow' ? '查证中…' : '浅度查证 · 消耗 1 点'}
          </button>
        )}
      </div>
      {shallowError && <p className="formal-game-error" role="alert">{shallowError}</p>}
      {shallowUnlock && <EvidenceBundle unlock={shallowUnlock} />}

      <div className="formal-evidence-action">
        <div><strong>深度查证</strong><small>{deepDisabledReason ?? '服务器扣除 3 点并返回本候选人的 T3 材料'}</small></div>
        {deepUnlock ? <span className="formal-sealed-mark">已解锁</span> : (
          <button
            type="button"
            className="button button--compact"
            disabled={!canUnlockDeep || pendingLevel !== null || expired}
            onClick={() => onUnlock('deep')}
          >
            {pendingLevel === 'deep' ? '查证中…' : '深度查证 · 消耗 3 点'}
          </button>
        )}
      </div>
      {deepError && <p className="formal-game-error" role="alert">{deepError}</p>}
      {deepUnlock && <EvidenceBundle unlock={deepUnlock} />}
    </section>
  )
}
