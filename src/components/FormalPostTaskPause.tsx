export function FormalPostTaskPause({ submitMode }: { submitMode: 'active' | 'timeout' }) {
  return (
    <main className="research-screen" data-testid="formal-post-task-pause">
      <section className="research-card">
        <span className="eyebrow">FORMAL ASSESSMENT · SAVED</span>
        <h1>本阶段已完成</h1>
        <p className="research-card__lead">最终录用结果已安全保存。测后状态与任务体验问卷将在下一阶段接入。</p>
        <p className="formal-save-meta">提交方式：{submitMode === 'timeout' ? '计时结束后由服务器封存' : '参与者主动提交'}</p>
      </section>
    </main>
  )
}
