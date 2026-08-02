import { useEffect, useState } from 'react'
import {
  AdminApiError,
  getAdminAuditLogs,
  getAdminSession,
  loginAdmin,
  logoutAdmin,
} from './adminApi'
import { AdminDashboard } from './AdminDashboard'
import { AdminLoginScreen } from './AdminLoginScreen'
import type { AdminAuditItem, AdminSessionData } from './adminTypes'

type View = 'checking' | 'login' | 'dashboard'

export function AdminApp() {
  const [view, setView] = useState<View>('checking')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<AdminSessionData | null>(null)
  const [audits, setAudits] = useState<AdminAuditItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadAuditPage = async (cursor: string | null = null) => {
    const page = await getAdminAuditLogs({ limit: 50, cursor })
    setAudits((current) => cursor ? [...current, ...page.items] : page.items)
    setNextCursor(page.nextCursor)
  }

  const enterDashboard = async (safeSession: AdminSessionData) => {
    setSession(safeSession)
    setView('dashboard')
    await loadAuditPage()
  }

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const safeSession = await getAdminSession()
        if (active) await enterDashboard(safeSession)
      } catch {
        if (active) setView('login')
      }
    })()
    return () => { active = false }
    // Initial administrator session check is intentionally performed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitLogin = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await loginAdmin(username, password)
      setPassword('')
      await enterDashboard(await getAdminSession())
    } catch (failure) {
      setPassword('')
      if (failure instanceof AdminApiError && failure.status === 429) {
        const wait = failure.retryAfterSec
          ? `（约 ${Math.ceil(failure.retryAfterSec / 60)} 分钟）`
          : ''
        setError(`尝试次数过多，请稍后再试。${wait}`)
      } else {
        setError('用户名或密码不正确。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      await loadAuditPage(nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }

  const logout = async () => {
    try {
      await logoutAdmin()
    } finally {
      setSession(null)
      setAudits([])
      setNextCursor(null)
      setPassword('')
      setView('login')
    }
  }

  if (view === 'checking') {
    return (
      <main className="admin-shell">
        <section className="admin-login-card" aria-live="polite">
          <span className="eyebrow">SECURE ADMIN CHANNEL</span>
          <h1>正在验证管理员会话</h1>
        </section>
      </main>
    )
  }
  if (view === 'login' || !session) {
    return (
      <AdminLoginScreen
        username={username}
        password={password}
        submitting={submitting}
        error={error}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onSubmit={submitLogin}
      />
    )
  }
  return (
    <AdminDashboard
      session={session}
      audits={audits}
      nextCursor={nextCursor}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
      onLogout={logout}
    />
  )
}
