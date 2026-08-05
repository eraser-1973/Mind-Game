import { useState } from 'react'
import { AdminAuditLogPanel } from './AdminAuditLogPanel'
import { AdminConfigurationConsole } from './AdminConfigurationConsole'
import { AdminResearchPanel } from './AdminResearchPanel'
import { AdminResearchExportPanel } from './AdminResearchExportPanel'
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
  const [section, setSection] = useState<'configuration' | 'research' | 'export' | 'audit'>('configuration')
  const isPublicMode = session.authMode === 'public'
  return (
    <main className="admin-shell admin-shell--dashboard" data-testid="admin-dashboard">
      {isPublicMode ? (
        <section className="admin-public-mode-warning" role="alert">
          <strong>PUBLIC ADMIN MODE</strong>
          <p>临时公开管理模式：任何获得该网址的人都可以查看、导出或删除研究数据。</p>
        </section>
      ) : null}
      <header className="admin-console-header">
        <div>
          <span className="eyebrow">MIND GAME · ADMIN</span>
          <h1>管理员控制台</h1>
          <p>安全认证基础已启用</p>
        </div>
        <button className="button button--ghost button--compact" onClick={() => void onLogout()}>
          {isPublicMode ? '返回首页' : '安全退出'}
        </button>
      </header>
      <section className="admin-session-card">
        <div><span>当前管理员</span><strong>{isPublicMode ? session.username : session.admin.username}</strong></div>
        <div><span>{isPublicMode ? '访问模式' : '绝对过期时间'}</span><strong>{isPublicMode ? 'PUBLIC ADMIN MODE' : new Date(session.session.absoluteExpiresAt).toLocaleString('zh-CN')}</strong></div>
      </section>
      <nav className="admin-dashboard-nav" aria-label="管理员功能">
        <button aria-pressed={section === 'configuration'} onClick={() => setSection('configuration')}>实验配置</button>
        <button aria-pressed={section === 'research'} onClick={() => setSection('research')}>数据记录</button>
        <button data-testid="admin-research-export-tab" aria-pressed={section === 'export'} onClick={() => setSection('export')}>导出数据</button>
        <button aria-pressed={section === 'audit'} onClick={() => setSection('audit')}>审计日志</button>
      </nav>
      {section === 'configuration' ? <AdminConfigurationConsole /> : section === 'research' ? <AdminResearchPanel /> : section === 'export' ? <AdminResearchExportPanel /> : <AdminAuditLogPanel
        items={audits}
        hasMore={nextCursor !== null}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />}
    </main>
  )
}
