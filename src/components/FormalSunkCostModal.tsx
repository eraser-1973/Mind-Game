import type { Candidate } from '../types/game'

export function FormalSunkCostModal({
  candidate,
  pointsInvested,
  pending,
  error,
  onChoose,
}: {
  candidate: Candidate
  pointsInvested: number
  pending: boolean
  error: string | null
  onChoose: (choice: 'continue' | 'stop_loss' | 'give_up') => void
}) {
  return (
    <div className="modal-backdrop">
      <section className="modal sunk-modal formal-sunk-modal" role="dialog" aria-modal="true" aria-labelledby="formal-sunk-title">
        <span className="eyebrow">DECISION CHECKPOINT</span>
        <h2 id="formal-sunk-title">请确认接下来的处理方式</h2>
        <p>你已在候选人 {candidate.id} 的材料查证中投入 {pointsInvested} 点资源。请选择下一步操作。</p>
        <div className="modal-choice-grid formal-neutral-choice-grid">
          {([
            ['continue', '追加验证', '继续使用剩余点数核验材料'],
            ['stop_loss', '立即止损', '停止向当前方向追加查证资源'],
            ['give_up', '放弃本轮补录', '结束信息采集并进入最终选择'],
          ] as const).map(([choice, title, detail]) => (
            <button className="formal-neutral-choice" disabled={pending} key={choice} onClick={() => onChoose(choice)}>
              <strong>{title}</strong><span>{detail}</span>
            </button>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}
