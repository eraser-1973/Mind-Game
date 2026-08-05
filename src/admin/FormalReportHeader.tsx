import type { AdminFormalAssessmentReport } from './adminTypes'

export function FormalReportHeader({ report }: { report: AdminFormalAssessmentReport }) {
  return <header className="admin-formal-report__header">
    <span className="eyebrow">FORMAL ASSESSMENT REPORT</span>
    <h2>正式测评结果报告</h2>
    <p>会话 {report.sessionSummary.sessionId.slice(0, 8)}… · {report.sessionSummary.status} · 配置 {report.versions.config}</p>
  </header>
}
