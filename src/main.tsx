import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { captureClientError } from './utils/clientErrors'
import './styles/game.css'

window.addEventListener('error', (event) => {
  const isResourceError = event.target !== window
  const cause = isResourceError
    ? new Error(`Resource failed to load: ${(event.target as HTMLImageElement | null)?.src ?? 'unknown resource'}`)
    : event.error ?? new Error(event.message)
  void captureClientError(cause, {
    errorType: isResourceError ? 'resource' : 'window_error',
    fatal: !isResourceError,
    affectedAssessment: true,
  })
}, true)

window.addEventListener('unhandledrejection', (event) => {
  void captureClientError(event.reason, {
    errorType: 'unhandled_rejection',
    fatal: true,
    affectedAssessment: true,
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
