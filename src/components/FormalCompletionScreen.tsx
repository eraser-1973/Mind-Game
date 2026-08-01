export function FormalCompletionScreen({ onReturnHome }: { onReturnHome: () => void }) {
  return (
    <main className="research-screen" data-testid="formal-completion-screen">
      <section className="research-card formal-completion-card">
        <span className="eyebrow">FORMAL ASSESSMENT · SUBMITTED</span>
        <div className="formal-completion-mark" aria-hidden="true">✓</div>
        <h1>提交成功</h1>
        <p className="research-card__lead">
          感谢您的参与。本次正式测评资料已完成保存，您现在可以安全关闭页面。
        </p>
        <div className="research-actions">
          <button
            className="button button--primary"
            data-testid="formal-completion-home"
            onClick={onReturnHome}
          >
            返回首页
          </button>
        </div>
      </section>
    </main>
  )
}
