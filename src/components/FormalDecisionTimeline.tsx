import type { FormalFinalDecision, FormalStageChoice } from '../types/formalGame'

export function FormalDecisionTimeline({
  stageChoices,
  finalDecision,
}: {
  stageChoices: FormalStageChoice[]
  finalDecision: FormalFinalDecision | null | undefined
}) {
  const t1 = stageChoices.find((choice) => choice.stage === 'T1')
  const t3 = stageChoices.find((choice) => choice.stage === 'T3')
  return (
    <section className="formal-decision-timeline" aria-label="决策轨迹">
      <span className="eyebrow">DECISION TRACE</span>
      <ul>
        <li>T1 后选择：{t1 ? `候选人 ${t1.candidateId}` : '待完成'}</li>
        <li>T2 阶段选择：本版本未设置</li>
        <li>T3 后选择：{t3 ? `候选人 ${t3.candidateId}` : '待完成'}</li>
        <li>最终选择：{finalDecision ? `候选人 ${finalDecision.candidateId}` : '待完成'}</li>
      </ul>
    </section>
  )
}
