import type { GameState, ReportData } from '../types/game'
import {
  CANDIDATE_DIMENSION_LABELS,
  CANDIDATE_DIMENSION_WEIGHTS,
} from '../data/candidates'
import { exportJson } from '../utils/exportJson'
import { formatDisplayedCopy } from '../utils/display'
import { buildAnonymousResearchExport } from '../utils/researchData'
import { formatTime } from '../utils/time'

type Props = {
  report: ReportData
  onRestart: () => void
  sourceState?: GameState
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

export function ReportScreen({ report, onRestart, sourceState }: Props) {
  const selected = report.selectedCandidate
  const submissionLabels = {
    manual: '主动提交',
    timeout_confirmed: '超时后确认',
    timeout_auto: '系统超时自动提交',
  } as const
  const logSummary = report.logs.slice(-16)
  const handleExportJson = () => {
    const exportData = sourceState
      ? buildAnonymousResearchExport(report, sourceState)
      : {
          schemaVersion: 'mind-game-report-v1',
          exportedAt: new Date().toISOString(),
          participantId: report.participantId,
          report,
        }

    exportJson(
      `mind-game-anonymous-${report.participantId ?? 'quick'}-${Date.now()}.json`,
      exportData,
    )
  }

  return (
    <main className="report-screen">
      <header className="report-hero">
        <div>
          <span className="eyebrow">DECISION RESILIENCE REPORT</span>
          <h1>抗压决策报告</h1>
          <p>报告基于本轮可观察操作生成，不用于临床诊断。</p>
          {report.researchData && (
            <p className="anonymous-record-note">
              研究数据已通过匿名编号 {report.participantId} 记录；本页面仅展示汇总解释，原始匿名数据可由研究者导出。
            </p>
          )}
        </div>
        <div className={'rdi-orb rdi-orb--' + report.rdi.level}>
          <span>RDI</span>
          <strong>{report.rdi.score}</strong>
          <small>{report.rdi.level}</small>
        </div>
      </header>

      {report.invalidForAssessment && (
        <section className="report-card report-section technical-invalid-notice" role="alert">
          <span className="eyebrow">TECHNICAL VALIDITY NOTICE</span>
          <h2>本次结果不作为有效测评数据</h2>
          <p>
            本次会话受到技术问题影响，结果不适合作为有效测评数据。技术故障不会被解释为低能力、低注意力或低韧性。
          </p>
          {report.invalidReason && <small>技术记录：{report.invalidReason}</small>}
        </section>
      )}

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
              <span>岗位匹配基准</span>
              <strong>{selected.baselineFitScore}</strong>
            </div>
            <div>
              <span>六维加权结果</span>
              <strong>{selected.baselineFitScore}</strong>
            </div>
          </div>
          <p>
            选择结果用于校验证据判断与岗位匹配基准之间的距离，而不是评价候选人的人格价值。
          </p>
          {sourceState?.finalDecision && (
            <p className="decision-submission-meta">
              {submissionLabels[sourceState.finalDecision.submissionType]} · 最终信心 {sourceState.finalDecision.confidence}/100
            </p>
          )}
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

      <section className="report-card report-section fit-score-card">
        <span className="eyebrow">岗位匹配基准分</span>
        <h2>{selected.baselineFitScore}/100</h2>
        <p>
          该分数由附件规定的六个岗位维度加权计算，仅在报告阶段公开，用于解释本轮证据修正与最终选择。
        </p>
        <div className="fit-score-grid">
          {Object.entries(selected.dimensionScores).map(([dimension, score]) => {
            const key = dimension as keyof typeof CANDIDATE_DIMENSION_LABELS
            return (
              <div key={dimension}>
                <span>{CANDIDATE_DIMENSION_LABELS[key]}</span>
                <strong>{score}/5</strong>
                <small>
                  权重 {Math.round(CANDIDATE_DIMENSION_WEIGHTS[key] * 100)}%
                </small>
              </div>
            )
          })}
        </div>
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
          <p>{formatDisplayedCopy(report.lossAversion)}</p>
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
        {report.mode === 'quick' && (
          <button className="button button--ghost" onClick={handleExportJson}>
            导出 JSON 数据
          </button>
        )}
      </footer>
    </main>
  )
}
