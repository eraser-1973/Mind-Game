import type { ReportData } from '../types/game'
import { formatTime } from '../utils/time'

type Props = {
  report: ReportData
  onRestart: () => void
}

const revisionText = (
  result: ReportData['revisions'][number]['result'],
) => {
  if (!result) return '只有初评或评分时间不足，暂无可计算修正斜率。'
  const direction =
    result.delta > 0 ? '上升' : result.delta < 0 ? '下降' : '保持'
  return (
    direction +
    ' ' +
    Math.abs(result.delta) +
    ' 分；每秒修正 ' +
    result.value.toFixed(3) +
    ' 分'
  )
}

export function ReportScreen({ report, onRestart }: Props) {
  const selected = report.selectedCandidate
  const logSummary = report.logs.slice(-16)

  return (
    <main className="report-screen">
      <header className="report-hero">
        <div>
          <span className="eyebrow">DECISION RESILIENCE REPORT</span>
          <h1>抗压决策报告</h1>
          <p>报告基于本轮可观察操作生成，不用于临床诊断。</p>
        </div>
        <div className={'rdi-orb rdi-orb--' + report.rdi.level}>
          <span>RDI</span>
          <strong>{report.rdi.score}</strong>
          <small>{report.rdi.level}</small>
        </div>
      </header>

      <section className="report-grid report-grid--lead">
        <article className="report-card selected-result">
          <span className="eyebrow">最终录用</span>
          <div className="selected-result__name">
            <span>{selected.id}</span>
            <div>
              <h2>{selected.name}</h2>
              <p>
                {selected.role} · {selected.school}
              </p>
            </div>
          </div>
          <div className="metric-pair">
            <div>
              <span>真实能力</span>
              <strong>{selected.trueAbility}</strong>
            </div>
            <div>
              <span>岗位匹配</span>
              <strong>{selected.trueFit}</strong>
            </div>
          </div>
          <p>
            选择结果用于校验证据判断与真实能力之间的距离，而不是评价候选人的人格价值。
          </p>
        </article>

        <article className="report-card">
          <span className="eyebrow">资源投资回报</span>
          <div className="large-metric">{report.roi.value.toFixed(2)}</div>
          <h3>ROI · 每点查证资源获得的能力值</h3>
          <p>
            {report.roi.note}
            。ROI 高不自动代表过程优质，未查证录用会单独标记风险。
          </p>
          {report.roi.unverifiedHire && (
            <span className="risk-pill">未查证直接录用</span>
          )}
        </article>
      </section>

      <section className="report-grid">
        <article className="report-card">
          <span className="eyebrow">注意力脱离</span>
          <h2>{report.attention.failed ? '出现脱离失败' : '脱离效率稳定'}</h2>
          <p>{report.attention.explanation}</p>
        </article>
        <article className="report-card">
          <span className="eyebrow">查证策略</span>
          <h2>{report.strategy}</h2>
          <p>{report.strategyExplanation}</p>
        </article>
        <article className="report-card">
          <span className="eyebrow">沉没成本</span>
          <h2>损失厌恶解释</h2>
          <p>{report.lossAversion}</p>
        </article>
      </section>

      <section className="report-card report-section">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">元认知修正</span>
            <h2>评分变化轨迹</h2>
          </div>
          <span className="count-badge">历史分数于报告阶段解封</span>
        </div>
        <div className="revision-list">
          {report.revisions.map(({ candidate, result }) => (
            <article key={candidate.id}>
              <div className="revision-list__identity">
                <span>{candidate.id}</span>
                <div>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.role}</small>
                </div>
              </div>
              <div className="revision-list__scores">
                <span>
                  T1 {report.runtime[candidate.id].ratings.T1?.value ?? '—'}
                </span>
                <span>
                  T2 {report.runtime[candidate.id].ratings.T2?.value ?? '—'}
                </span>
                <span>
                  T3 {report.runtime[candidate.id].ratings.T3?.value ?? '—'}
                </span>
              </div>
              <p>{revisionText(result)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="report-grid report-grid--logs">
        <article className="report-card">
          <span className="eyebrow">RDI 解释</span>
          <h2>
            {report.rdi.level} · {report.rdi.score}/100
          </h2>
          <p>{report.rdi.explanation}</p>
          <div className="raw-metrics">
            <span>能力 {report.rdi.rawData.selectedAbility}</span>
            <span>匹配 {report.rdi.rawData.selectedFit}</span>
            <span>
              修正质量 {Math.round(report.rdi.rawData.revisionQuality)}
            </span>
          </div>
        </article>
        <article className="report-card">
          <span className="eyebrow">候选人停留时间</span>
          <div className="view-time-list">
            {Object.values(report.runtime).map((item) => (
              <div key={item.candidateId}>
                <span>终端 {item.candidateId}</span>
                <strong>{(item.viewTimeMs / 1000).toFixed(1)} 秒</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="report-card report-section">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">操作日志摘要</span>
            <h2>最近 {logSummary.length} 项行为</h2>
          </div>
          <span className="count-badge">共 {report.logs.length} 条</span>
        </div>
        <div className="log-list">
          {logSummary.length ? (
            logSummary.map((log) => (
              <div key={log.id}>
                <time>{formatTime(log.elapsedSec)}</time>
                <span>{log.pressureStage.toUpperCase()}</span>
                <p>{log.detail}</p>
                <small>反应间隔 {log.responseTimeSec}s</small>
              </div>
            ))
          ) : (
            <p className="empty-state">本轮没有额外操作日志。</p>
          )}
        </div>
      </section>

      <footer className="report-actions">
        <button className="button button--primary" onClick={onRestart}>
          重新开始
        </button>
      </footer>
    </main>
  )
}
