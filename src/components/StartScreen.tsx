import type { GameMode } from '../types/game'
import { RecruitmentCabin3D } from './RecruitmentCabin3D'

type Props = {
  onStart: (mode: GameMode) => void
}

export function StartScreen({ onStart }: Props) {
  return (
    <main className="start-screen">
      <RecruitmentCabin3D />
      <section className="start-card">
        <p className="eyebrow">48H 补录窗口 · HR 压力决策实验</p>
        <h1>
          压力择才
          <span>招聘模拟舱</span>
        </h1>
        <p className="start-card__lead">
          你有有限的时间和 5 点查证资源。完成五人初评、识别证据质量，并在压力升级前给出最终录用决定。
        </p>
        <div className="mission-grid">
          <article>
            <strong>05</strong>
            <span>候选人</span>
          </article>
          <article>
            <strong>05</strong>
            <span>查证点</span>
          </article>
          <article>
            <strong>T1—T3</strong>
            <span>三次判断</span>
          </article>
        </div>
        <div className="briefing">
          <h2>行动规则</h2>
          <ol>
            <li>先完成 5 名候选人的 T1 独立初评。</li>
            <li>浅查消耗 1 点，深查消耗 3 点；分数提交后封存。</li>
            <li>压力阶段会升级，最后阶段可能触发沉没成本事件。</li>
          </ol>
        </div>
        <div className="mode-actions">
          <button className="button button--primary" onClick={() => onStart('quick')}>
            快速测试 · 3 分钟
          </button>
          <button className="button button--ghost" onClick={() => onStart('formal')}>
            正式测评 · 15 分钟
          </button>
        </div>
        <p className="disclaimer">
          本游戏用于训练与研究演示，不构成临床心理诊断或真实招聘结论。
        </p>
      </section>
    </main>
  )
}
