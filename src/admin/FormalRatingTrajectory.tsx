import type { AdminFormalAssessmentReport } from './adminTypes'

export function FormalRatingTrajectory({ report }: { report: AdminFormalAssessmentReport }) {
  return <section className="admin-formal-report__section"><h3>评分轨迹</h3><table><thead><tr><th>候选人</th><th>T1</th><th>T2</th><th>T3</th></tr></thead><tbody>
    {['A', 'B', 'C', 'D', 'E'].map((candidateId) => <tr key={candidateId}><td>{candidateId}</td>{['T1', 'T2', 'T3'].map((stage) => <td key={stage}>{report.stageRatings.find((rating) => rating.candidateId === candidateId && rating.stage === stage)?.ratingValue ?? '未评分'}</td>)}</tr>)}
  </tbody></table></section>
}
