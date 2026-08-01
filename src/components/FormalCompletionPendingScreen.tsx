import { useEffect, useRef, useState } from 'react'

export function FormalCompletionPendingScreen({
  onComplete,
  onExit,
}: {
  onComplete: () => Promise<void>
  onExit: () => void
}) {
  const onCompleteRef = useRef(onComplete)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onCompleteRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法完成提交，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    void submit()
    // The same sessionStorage idempotency key makes StrictMode and retries safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="research-screen" data-testid="formal-completion-pending">
      <section className="research-card">
        <span className="eyebrow">FINALIZING SESSION</span>
        <h1>正在完成提交</h1>
        <p className="research-card__lead">
          两份测后问卷已经封存，正在等待服务器确认本次正式测评完整结束。
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="research-actions">
          <button className="button button--ghost" onClick={onExit}>安全返回入口</button>
          {error && (
            <button
              className="button button--primary"
              data-testid="retry-formal-completion"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? '正在重试…' : '重试提交'}
            </button>
          )}
        </div>
      </section>
    </main>
  )
}
