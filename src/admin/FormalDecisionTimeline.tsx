import type { AdminFormalAssessmentReport } from './adminTypes'

function label(value: { candidateId: string } | null, fallback = '未作答') { return value ? `候选人 ${value.candidateId}` : fallback }

export function FormalDecisionTimeline({ report }: { report: AdminFormalAssessmentReport }) {
  return <section className="admin-formal-report__section"><h3>决策结果</h3><ul>
    <li>T1 后选择：{label(report.stageChoices.t1)}</li>
    <li>T2 后选择：{label(report.stageChoices.t2, '本版本未设置')}</li>
    <li>T3 后选择：{label(report.stageChoices.t3)}</li>
    <li>最终选择：{label(report.finalDecision)}</li>
  </ul></section>
}
