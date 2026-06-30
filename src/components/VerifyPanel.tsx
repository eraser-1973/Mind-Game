import type { CandidateRuntimeState, VerifyType } from '../types/game'

type Props = {
  runtime: CandidateRuntimeState
  availablePoints: number
  locked: boolean
  onVerify: (type: VerifyType) => void
}

export function VerifyPanel({
  runtime,
  availablePoints,
  locked,
  onVerify,
}: Props) {
  return (
    <section className="verify-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">证据操作</span>
          <h3>分配查证资源</h3>
        </div>
        {locked && <span className="lock-note">完成全部 T1 后解锁</span>}
      </div>
      <div className="verify-actions">
        <button
          className="verify-button"
          disabled={locked || runtime.shallowUnlocked || availablePoints < 1}
          onClick={() => onVerify('shallow')}
        >
          <span className="verify-button__cost">−1</span>
          <strong>浅度查证</strong>
          <small>
            {runtime.shallowUnlocked ? '初步线索已取得' : '核对经历与过程记录'}
          </small>
        </button>
        <button
          className="verify-button verify-button--deep"
          disabled={locked || runtime.deepUnlocked || availablePoints < 3}
          onClick={() => onVerify('deep')}
          title={availablePoints < 3 ? '深度查证需要 3 点' : undefined}
        >
          <span className="verify-button__cost">−3</span>
          <strong>深度查证</strong>
          <small>
            {runtime.deepUnlocked ? '关键证据已取得' : '现场验证或追溯原始材料'}
          </small>
        </button>
      </div>
      {!locked && availablePoints < 3 && !runtime.deepUnlocked && (
        <p className="inline-warning" role="status">
          当前不足 3 点，无法进行新的深度查证。
        </p>
      )}
    </section>
  )
}
