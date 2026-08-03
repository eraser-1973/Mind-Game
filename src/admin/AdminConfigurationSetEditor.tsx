import { useEffect, useState } from 'react'
import { adminConfigurationApi } from './adminApi'
import type { AdminConfigurationDetail, AdminMaterialDetail, AdminRuleDetail } from './adminTypes'

export function AdminConfigurationSetEditor({ detail, activeConfiguration, materials, pointRules, sunkRules, onReload }: {
  detail: AdminConfigurationDetail
  activeConfiguration: AdminConfigurationDetail | null
  materials: Array<Pick<AdminMaterialDetail, 'version' | 'status'>>
  pointRules: AdminRuleDetail[]
  sunkRules: AdminRuleDetail[]
  onReload: () => Promise<void>
}) {
  const [draft, setDraft] = useState(detail)
  const [confirmId, setConfirmId] = useState('')
  useEffect(() => { setDraft(detail); setConfirmId('') }, [detail])
  const readOnly = draft.status !== 'draft'
  const save = async () => {
    await adminConfigurationApi.updateConfiguration(draft.configSetId, {
      expectedRevision: draft.revision, displayName: draft.displayName,
      taskVersion: draft.taskVersion, materialVersion: draft.materialVersion,
      pointRuleVersion: draft.pointRuleVersion, sunkCostRuleVersion: draft.sunkCostRuleVersion,
      scoringVersion: draft.scoringVersion, benchmarkVersion: draft.benchmarkVersion, normVersion: null,
    }); await onReload()
  }
  return <section className="admin-config-editor" data-testid="admin-configuration-editor">
    <header><h2>{draft.configSetId}</h2><span>{draft.active ? '当前生效' : draft.status} · r{draft.revision}</span></header>
    <label>显示名称<input disabled={readOnly} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
    <label>材料版本<select disabled={readOnly} value={draft.materialVersion} onChange={(event) => setDraft({ ...draft, materialVersion: event.target.value })}>{materials.filter(({ status }) => status === 'published').map(({ version }) => <option key={version}>{version}</option>)}</select></label>
    <label>点数规则<select disabled={readOnly} value={draft.pointRuleVersion} onChange={(event) => setDraft({ ...draft, pointRuleVersion: event.target.value })}>{pointRules.filter(({ status }) => status === 'published').map(({ version }) => <option key={version}>{version}</option>)}</select></label>
    <label>沉没成本规则<select disabled={readOnly} value={draft.sunkCostRuleVersion} onChange={(event) => setDraft({ ...draft, sunkCostRuleVersion: event.target.value })}>{sunkRules.filter(({ status }) => status === 'published').map(({ version }) => <option key={version}>{version}</option>)}</select></label>
    <p>评分：{draft.scoringVersion} · 基准：{draft.benchmarkVersion} · 常模：未设置</p>
    <p>校验状态：{draft.validationStatus}</p>
    {draft.validationReport.errors.map((issue) => <p role="alert" key={`${issue.code}-${issue.path}`}>{issue.path}: {issue.code}</p>)}
    {draft.validationReport.warnings.map((issue) => <p key={`${issue.code}-${issue.path}`}>{issue.path}: {issue.code}</p>)}
    <div className="admin-config-actions">
      <button disabled={readOnly} onClick={() => void save()}>保存</button>
      <button disabled={readOnly} onClick={() => void adminConfigurationApi.validateConfiguration(draft.configSetId).then(onReload)}>校验</button>
      <button disabled={readOnly || draft.validationStatus !== 'valid'} onClick={() => {
        if (window.confirm(`发布 ${draft.configSetId} 后不会自动激活。确认发布？`)) void adminConfigurationApi.publishConfiguration(draft.configSetId).then(onReload)
      }}>发布（不激活）</button>
    </div>
    {draft.status === 'published' && !draft.active && <div className="admin-activation-box">
      <h3>{draft.activatedAt ? '回滚激活确认' : '激活确认'}</h3>
      <p>激活会让新会话使用此配置；既有会话不受影响。重新激活旧版本属于回滚激活。</p>
      <table><caption>当前生效配置与目标配置差异</caption><thead><tr><th>组件</th><th>当前生效</th><th>目标</th></tr></thead><tbody>
        {([
          ['材料', 'materialVersion'], ['点数规则', 'pointRuleVersion'],
          ['沉没成本', 'sunkCostRuleVersion'], ['评分', 'scoringVersion'],
          ['基准', 'benchmarkVersion'], ['常模', 'normVersion'],
        ] as const).map(([label, key]) => <tr key={key}><th>{label}</th>
          <td>{activeConfiguration?.[key] ?? '未设置'}</td><td>{draft[key] ?? '未设置'}</td></tr>)}
      </tbody></table>
      <label>输入目标配置 ID 确认<input value={confirmId} onChange={(event) => setConfirmId(event.target.value)} /></label>
      <button disabled={confirmId !== draft.configSetId} onClick={() => void adminConfigurationApi.activateConfiguration(draft.configSetId).then(onReload)}>激活配置</button>
    </div>}
  </section>
}
