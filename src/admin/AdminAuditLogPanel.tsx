import type { AdminAuditItem } from './adminTypes'

export function AdminAuditLogPanel({
  items,
  hasMore,
  loading,
  onLoadMore,
}: {
  items: AdminAuditItem[]
  hasMore: boolean
  loading: boolean
  onLoadMore: () => Promise<void>
}) {
  return (
    <section className="admin-panel" aria-labelledby="admin-audit-title">
      <div className="admin-panel__heading">
        <div>
          <span className="eyebrow">IMMUTABLE SECURITY LOG</span>
          <h2 id="admin-audit-title">最近管理员审计日志</h2>
        </div>
        <span className="admin-status-chip">只读</span>
      </div>
      <div className="admin-audit-list">
        {items.length === 0 && <p className="admin-empty">暂无可显示的管理员审计记录。</p>}
        {items.map((item) => (
          <article key={item.auditId}>
            <div>
              <strong>{item.action}</strong>
              <span>{item.outcome}</span>
            </div>
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
            <small>请求 {item.requestId}</small>
          </article>
        ))}
      </div>
      {hasMore && (
        <button className="button button--ghost button--compact" disabled={loading} onClick={() => void onLoadMore()}>
          {loading ? '正在加载…' : '加载更多'}
        </button>
      )}
    </section>
  )
}
