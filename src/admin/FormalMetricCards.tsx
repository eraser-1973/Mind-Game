import type { AdminFormalAssessmentReport } from './adminTypes'

export function FormalMetricCards({ report }: { report: AdminFormalAssessmentReport }) {
  return <section className="admin-formal-report__section"><h3>正式指标</h3><div className="admin-formal-report__metrics">
    {report.derivedMetrics.length === 0 ? <p>未计算 / 参数未启用 / 数据不足</p> : report.derivedMetrics.map((metric) => <article key={metric.metricCode}>
      <strong>{metric.metricCode}</strong><span>{metric.numericValue === null ? '未计算' : metric.numericValue}</span><small>{metric.calculationStatus}</small>
    </article>)}
  </div></section>
}
