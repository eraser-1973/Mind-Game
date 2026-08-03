import { useEffect, useState } from 'react'
import { AdminApiError, adminConfigurationApi } from './adminApi'
import type { AdminMaterialDetail, AdminMaterialEvidence, AdminMaterialProfile } from './adminTypes'

export function AdminMaterialEditor({ detail, onReload }: {
  detail: AdminMaterialDetail
  onReload: () => Promise<void>
}) {
  const [draft, setDraft] = useState(detail)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const readOnly = draft.status !== 'draft'
  useEffect(() => setDraft(detail), [detail])

  const updateProfile = (index: number, patch: Partial<AdminMaterialProfile>) => {
    setDraft((current) => ({ ...current, profiles: current.profiles.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))
  }
  const updateEvidence = (index: number, patch: Partial<AdminMaterialEvidence>) => {
    setDraft((current) => ({ ...current, evidence: current.evidence.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))
  }
  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage(null)
    try { await action(); setMessage(success); await onReload() }
    catch (error) {
      setMessage(error instanceof AdminApiError && error.code === 'CONFIG_REVISION_CONFLICT'
        ? '版本已被其他页面修改，请重新载入后继续。'
        : error instanceof Error ? error.message : '操作失败。')
    } finally { setBusy(false) }
  }

  return (
    <section className="admin-config-editor" data-testid="admin-material-editor">
      <header><div><span className="eyebrow">MATERIAL VERSION</span><h2>{draft.version}</h2></div>
        <span className={`admin-config-status admin-config-status--${draft.status}`}>{draft.status} · r{draft.revision}</span></header>
      <label>显示名称<input value={draft.displayName} disabled={readOnly || busy}
        onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
      <div className="admin-material-grid">
        {draft.profiles.map((profile, index) => (
          <fieldset key={profile.candidateId} disabled={readOnly || busy}>
            <legend>候选人 {profile.candidateId}</legend>
            <label>姓名<input value={profile.name} onChange={(event) => updateProfile(index, { name: event.target.value })} /></label>
            <label>岗位<input value={profile.role} onChange={(event) => updateProfile(index, { role: event.target.value })} /></label>
            <label>学校<input value={profile.school} onChange={(event) => updateProfile(index, { school: event.target.value })} /></label>
            <label>简历摘要<textarea value={profile.resumeSummary} onChange={(event) => updateProfile(index, { resumeSummary: event.target.value })} /></label>
            <label>教育背景<textarea value={profile.education} onChange={(event) => updateProfile(index, { education: event.target.value })} /></label>
            <label>初始形象<textarea value={profile.initialImage} onChange={(event) => updateProfile(index, { initialImage: event.target.value })} /></label>
            <label>可见光环（每行一项）<textarea value={profile.visibleHalo.join('\n')} onChange={(event) => updateProfile(index, { visibleHalo: event.target.value.split('\n') })} /></label>
            <label>技能（每行一项）<textarea value={profile.skills.join('\n')} onChange={(event) => updateProfile(index, { skills: event.target.value.split('\n') })} /></label>
            <label>公开标签（每行一项）<textarea value={profile.publicTags.join('\n')} onChange={(event) => updateProfile(index, { publicTags: event.target.value.split('\n') })} /></label>
            {profile.experiences.map((experience, experienceIndex) => (
              <div className="admin-experience-row" key={`${profile.candidateId}-${experienceIndex}`}>
                <input aria-label={`${profile.candidateId} 经历标题 ${experienceIndex + 1}`} value={experience.title}
                  onChange={(event) => updateProfile(index, { experiences: profile.experiences.map((item, i) => i === experienceIndex ? { ...item, title: event.target.value } : item) })} />
                <textarea aria-label={`${profile.candidateId} 经历内容 ${experienceIndex + 1}`} value={experience.content}
                  onChange={(event) => updateProfile(index, { experiences: profile.experiences.map((item, i) => i === experienceIndex ? { ...item, content: event.target.value } : item) })} />
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="admin-evidence-list">
        {draft.evidence.map((item, index) => (
          <fieldset key={item.evidenceId} disabled={readOnly || busy}>
            <legend>{item.candidateId} · {item.level} · {item.order}</legend>
            <label>标题<input value={item.title} onChange={(event) => updateEvidence(index, { title: event.target.value })} /></label>
            <label>正文<textarea value={item.content} onChange={(event) => updateEvidence(index, { content: event.target.value })} /></label>
            <div className="admin-inline-options">
              <label><input type="radio" name={`polarity-${item.evidenceId}`} checked={item.polarity === 'positive'} onChange={() => updateEvidence(index, { polarity: 'positive' })} />positive</label>
              <label><input type="radio" name={`polarity-${item.evidenceId}`} checked={item.polarity === 'negative'} onChange={() => updateEvidence(index, { polarity: 'negative' })} />negative</label>
              <label><input type="checkbox" checked={item.isKeyRisk} onChange={(event) => updateEvidence(index, { isKeyRisk: event.target.checked })} />关键风险</label>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="admin-validation-report">
        <strong>校验：{draft.validationStatus}</strong>
        {draft.validationReport.errors.map((item) => <p role="alert" key={`${item.code}-${item.path}`}>{item.path}: {item.code}</p>)}
        {draft.validationReport.warnings.map((item) => <p key={`${item.code}-${item.path}`}>{item.path}: {item.code}</p>)}
      </div>
      {message && <p className="admin-config-message" role="status">{message}</p>}
      <div className="admin-config-actions">
        <button className="button button--ghost" disabled={readOnly || busy} onClick={() => void perform(
          () => adminConfigurationApi.updateMaterial(draft.version, {
            expectedRevision: draft.revision, displayName: draft.displayName,
            document: { profiles: draft.profiles, evidence: draft.evidence },
          }), '草稿已保存，需重新校验。')}>保存</button>
        <button className="button button--ghost" disabled={readOnly || busy} onClick={() => void perform(
          () => adminConfigurationApi.validateMaterial(draft.version), '校验已完成。')}>校验</button>
        <button className="button button--primary" disabled={readOnly || busy || draft.validationStatus !== 'valid' || draft.validationReport.errors.length > 0}
          onClick={() => {
            if (window.confirm(`发布 ${draft.version} 后将不可修改。确认发布？`)) {
              void perform(() => adminConfigurationApi.publishMaterial(draft.version), '材料版本已发布。')
            }
          }}>发布</button>
      </div>
    </section>
  )
}
