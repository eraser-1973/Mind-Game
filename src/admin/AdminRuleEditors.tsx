import { useEffect, useState } from 'react'
import { adminConfigurationApi } from './adminApi'
import type { AdminRuleDetail } from './adminTypes'

export function AdminRuleEditor({ kind, detail, onReload }: {
  kind: 'point' | 'sunk'
  detail: AdminRuleDetail
  onReload: () => Promise<void>
}) {
  const [draft, setDraft] = useState(detail)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => setDraft(detail), [detail])
  const readOnly = draft.status !== 'draft'
  const setRule = (key: string, value: number | boolean) => setDraft((current) => ({ ...current, rule: { ...current.rule, [key]: value } }))
  const save = async () => {
    try {
      if (kind === 'point') await adminConfigurationApi.updatePointRule(draft.version, { expectedRevision: draft.revision, displayName: draft.displayName, rule: draft.rule })
      else await adminConfigurationApi.updateSunkRule(draft.version, { expectedRevision: draft.revision, displayName: draft.displayName, rule: draft.rule })
      setMessage('草稿已保存。'); await onReload()
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。') }
  }
  const validate = async () => {
    if (kind === 'point') await adminConfigurationApi.validatePointRule(draft.version)
    else await adminConfigurationApi.validateSunkRule(draft.version)
    await onReload()
  }
  const publish = async () => {
    if (!window.confirm(`发布 ${draft.version} 后将不可修改。确认发布？`)) return
    if (kind === 'point') await adminConfigurationApi.publishPointRule(draft.version)
    else await adminConfigurationApi.publishSunkRule(draft.version)
    await onReload()
  }
  const numericFields = kind === 'point'
    ? [['totalPoints', '总点数'], ['shallowCost', '浅查成本'], ['deepCost', '深查成本']] as const
    : [['triggerRemainingSec', '触发剩余秒数'], ['minimumCandidateInvestment', '最低候选人投入']] as const
  return <section className="admin-config-editor" data-testid={`admin-${kind}-rule-editor`}>
    <header><h2>{draft.version}</h2><span>{draft.status} · r{draft.revision}</span></header>
    <label>显示名称<input disabled={readOnly} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
    {numericFields.map(([key, label]) => <label key={key}>{label}<input type="number" disabled={readOnly} value={Number(draft.rule[key])}
      onChange={(event) => setRule(key, Number(event.target.value))} /></label>)}
    {kind === 'sunk' && <label><input type="checkbox" disabled={readOnly} checked={Boolean(draft.rule.requiresKeyRisk)} onChange={(event) => setRule('requiresKeyRisk', event.target.checked)} />要求关键风险证据</label>}
    <p>校验状态：{draft.validationStatus}</p>
    {draft.validationReport.errors.map((issue) => <p role="alert" key={`${issue.code}-${issue.path}`}>{issue.path}: {issue.code}</p>)}
    {draft.validationReport.warnings.map((issue) => <p key={`${issue.code}-${issue.path}`}>{issue.path}: {issue.code}</p>)}
    {message && <p role="status">{message}</p>}
    <div className="admin-config-actions"><button disabled={readOnly} onClick={() => void save()}>保存</button><button disabled={readOnly} onClick={() => void validate()}>校验</button><button disabled={readOnly || draft.validationStatus !== 'valid'} onClick={() => void publish()}>发布</button></div>
  </section>
}
