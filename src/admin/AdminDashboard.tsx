import { useState } from 'react'
import { AdminAuditLogPanel } from './AdminAuditLogPanel'
import { AdminConfigurationConsole } from './AdminConfigurationConsole'
import type { AdminAuditItem, AdminSessionData } from './adminTypes'

export function AdminDashboard({
  session,
  audits,
  nextCursor,
  loadingMore,
  onLoadMore,
  onLogout,
}: {
  session: AdminSessionData
  audits: AdminAuditItem[]
  nextCursor: string | null
  loadingMore: boolean
  onLoadMore: () => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [section, setSection] = useState<'configuration' | 'audit'>('configuration')
  return (
    <main className="admin-shell admin-shell--dashboard" data-testid="admin-dashboard">
      <header className="admin-console-header">
        <div>
          <span className="eyebrow">MIND GAME · ADMIN</span>
          <h1>管理员控制台</h1>
          <p>安全认证基础已启用</p>
        </div>
        <button className="button button--ghost button--compact" onClick={() => void onLogout()}>
          安全退出
        </button>
      </header>
      <section className="admin-session-card">
        <div><span>当前管理员</span><strong>{session.admin.username}</strong></div>
        <div><span>绝对过期时间</span><strong>{new Date(session.session.absoluteExpiresAt).toLocaleString('zh-CN')}</strong></div>
      </section>
      <nav className="admin-dashboard-nav" aria-label="管理员功能">
        <button aria-pressed={section === 'configuration'} onClick={() => setSection('configuration')}>实验配置</button>
        <button aria-pressed={section === 'audit'} onClick={() => setSection('audit')}>审计日志</button>
      </nav>
      {section === 'configuration' ? <AdminConfigurationConsole /> : <AdminAuditLogPanel
        items={audits}
        hasMore={nextCursor !== null}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />}
    </main>
  )
}
