import { useEffect, useState } from 'react'
import { adminResearchApi } from './adminApi'
import type { AdminResearchSession } from './adminTypes'

export function AdminResearchPanel() {
  const [items, setItems] = useState<AdminResearchSession[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<AdminResearchSession | null>(null)
  const load = async (next: string | null = null) => { const page = await adminResearchApi.listSessions(next); setItems((current) => next ? [...current, ...page.items] : page.items); setCursor(page.nextCursor) }
  useEffect(() => { void load() }, [])
  const toggle = (sessionId: string) => setSelected((current) => current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId])
  const showDetail = async (sessionId: string) => { setBusy(true); try { setDetail(await adminResearchApi.getSession(sessionId)) } finally { setBusy(false) } }
  const remove = async (sessionId: string) => { if (!window.confirm('确认永久删除这条研究记录？此操作无法撤销。')) return; setBusy(true); try { await adminResearchApi.deleteSession(sessionId); setItems((current) => current.filter((item) => item.sessionId !== sessionId)); setSelected((current) => current.filter((id) => id !== sessionId)); setMessage('已永久删除记录。') } finally { setBusy(false) } }
  const removeSelected = async () => { if (!selected.length || !window.confirm(`确认永久删除选中的 ${selected.length} 条研究记录？`)) return; setBusy(true); try { await adminResearchApi.bulkDelete(selected); setItems((current) => current.filter((item) => !selected.includes(item.sessionId))); setSelected([]); setMessage('已永久删除选中记录。') } finally { setBusy(false) } }
  return <section className="admin-research-panel" data-testid="admin-research-panel">
    <header><div><h2>数据记录</h2><p>仅显示脱敏身份摘要；删除为不可恢复的永久删除。</p></div></header>
    {message && <p className="admin-research-message" role="status">{message}</p>}
    <div className="admin-research-actions"><button className="button button--danger" disabled={busy || !selected.length} onClick={() => void removeSelected()}>删除已选（{selected.length}）</button></div>
    <div className="admin-research-table-wrap"><table><thead><tr><th>选择</th><th>会话</th><th>身份摘要</th><th>状态</th><th>开始时间</th><th>质量标记</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.sessionId}><td><input aria-label={`选择 ${item.sessionId}`} type="checkbox" checked={selected.includes(item.sessionId)} onChange={() => toggle(item.sessionId)} /></td><td><code>{item.sessionId}</code></td><td>{[item.identity.name, item.identity.studentId, item.identity.phone].filter(Boolean).join(' / ') || '—'}</td><td>{item.status}</td><td>{item.startedAt ? new Date(item.startedAt).toLocaleString('zh-CN') : '—'}</td><td>{item.qualityFlags.join(', ') || '—'}</td><td className="admin-research-row-actions"><button className="button button--ghost button--compact" data-testid={`admin-research-detail-${item.sessionId}`} disabled={busy} onClick={() => void showDetail(item.sessionId)}>查看详情</button><button className="button button--ghost button--compact" disabled={busy} onClick={() => void remove(item.sessionId)}>永久删除</button></td></tr>)}</tbody></table></div>
    {detail && <section className="admin-research-detail" data-testid="admin-research-detail"><header><h3>会话详情</h3><button className="button button--ghost button--compact" onClick={() => setDetail(null)}>关闭</button></header><dl><div><dt>会话</dt><dd><code>{detail.sessionId}</code></dd></div><div><dt>身份摘要</dt><dd>{[detail.identity.name, detail.identity.studentId, detail.identity.phone].filter(Boolean).join(' / ') || '—'}</dd></div><div><dt>状态</dt><dd>{detail.status}</dd></div><div><dt>当前步骤</dt><dd>{detail.currentStep}</dd></div><div><dt>任务版本</dt><dd>{detail.taskVersion}</dd></div><div><dt>材料版本</dt><dd>{detail.materialVersion}</dd></div></dl></section>}
    {cursor && <button className="button button--ghost" disabled={busy} onClick={() => void load(cursor)}>加载更多</button>}
  </section>
}
