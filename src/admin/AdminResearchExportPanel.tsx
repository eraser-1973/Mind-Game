import { useState } from 'react'
import { adminResearchApi } from './adminApi'

export function AdminResearchExportPanel() {
  const [busy, setBusy] = useState(false)
  const [exportedAt, setExportedAt] = useState<string | null>(null)

  const exportAll = async () => {
    setBusy(true)
    try {
      const { blob, filename } = await adminResearchApi.exportAll()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = filename
      link.click()
      URL.revokeObjectURL(href)
      setExportedAt(new Date().toLocaleString('zh-CN'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="admin-research-panel" data-testid="admin-research-export-panel">
    <header><div><h2>导出数据</h2><p>下载包含 13 份 CSV 文件的研究数据 ZIP；手机号在导出中默认脱敏。</p></div></header>
    <div className="admin-research-actions"><button className="button" disabled={busy} onClick={() => void exportAll()}>导出全部研究数据</button></div>
    {exportedAt && <p className="admin-research-message" role="status">导出已生成：{exportedAt}</p>}
  </section>
}
