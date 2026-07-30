import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearRecoveryPointer } from '../persistence/formalSessionStore'
import { captureClientError } from '../utils/clientErrors'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void captureClientError(
      new Error(`${error.message}\n${info.componentStack ?? ''}`),
      { errorType: 'react_boundary', fatal: true, affectedAssessment: true },
    )
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="research-screen">
        <section className="research-card" role="alert">
          <span className="eyebrow">SESSION RECOVERY</span>
          <h1>页面遇到技术问题</h1>
          <p className="research-card__lead">
            本次技术故障已与测评表现分离记录。你可以重试页面或恢复本机保存的会话。
          </p>
          <div className="research-actions">
            <button className="button button--primary" onClick={() => window.location.reload()}>
              重试并恢复会话
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                clearRecoveryPointer()
                window.location.assign('/')
              }}
            >
              安全退出
            </button>
          </div>
        </section>
      </main>
    )
  }
}
