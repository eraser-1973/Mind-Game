import type { AdminFormalAssessmentReport as Report } from './adminTypes'
import { FormalReportHeader } from './FormalReportHeader'
import { FormalDecisionTimeline } from './FormalDecisionTimeline'
import { FormalMetricCards } from './FormalMetricCards'
import { FormalRatingTrajectory } from './FormalRatingTrajectory'

export function AdminFormalAssessmentReport({ report }: { report: Report }) {
  return <section className="admin-formal-report" data-testid="admin-formal-assessment-report">
    <FormalReportHeader report={report} />
    <FormalDecisionTimeline report={report} />
    <section className="admin-formal-report__section"><h3>查证行为</h3><p>{report.pointSummary ? `总点数 ${report.pointSummary.totalPoints} · 已用 ${report.pointSummary.usedPoints} · 剩余 ${report.pointSummary.remainingPoints}` : '尚未启动查证'}</p></section>
    <FormalRatingTrajectory report={report} />
    <FormalMetricCards report={report} />
  </section>
}
