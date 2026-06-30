import type { SunkCostChoice } from '../types/game'

type Props = {
  candidateName: string
  spentPoints: number
  onChoose: (choice: Exclude<SunkCostChoice, null>) => void
}

export function SunkCostModal({
  candidateName,
  spentPoints,
  onChoose,
}: Props) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal sunk-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sunk-title"
      >
        <div className="alert-icon">!</div>
        <span className="eyebrow">压力事件 / SUNK COST</span>
        <h2 id="sunk-title">资源投入正在影响判断</h2>
        <p>
          你已经在 <strong>{candidateName}</strong> 身上投入 {spentPoints} 点查证资源，
          但证据仍存在明显风险。王总要求你立刻决定下一步。
        </p>
        <div className="modal-choice-grid">
          <button onClick={() => onChoose('continue')}>
            <strong>追加验证</strong>
            <span>维持原方向，承担继续投入的心理成本</span>
          </button>
          <button className="is-recommended" onClick={() => onChoose('stop_loss')}>
            <strong>立即止损</strong>
            <span>把已投入资源视为不可追回，转向比较</span>
          </button>
          <button onClick={() => onChoose('give_up')}>
            <strong>放弃本轮补录</strong>
            <span>停止风险暴露，但可能错失可用候选人</span>
          </button>
        </div>
      </section>
    </div>
  )
}
