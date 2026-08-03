import { useCallback, useEffect, useState } from 'react'
import { adminConfigurationApi } from './adminApi'
import type { AdminConfigurationDetail, AdminMaterialDetail, AdminRuleDetail } from './adminTypes'
import { AdminConfigurationSetEditor } from './AdminConfigurationSetEditor'
import { AdminMaterialEditor } from './AdminMaterialEditor'
import { AdminRuleEditor } from './AdminRuleEditors'

type Tab = 'active' | 'materials' | 'points' | 'sunk' | 'sets'

export function AdminConfigurationConsole() {
  const [tab, setTab] = useState<Tab>('active')
  const [materials, setMaterials] = useState<Array<Pick<AdminMaterialDetail, 'version' | 'displayName' | 'status' | 'revision' | 'validationStatus' | 'publishedAt'> & { usedByActiveConfig: boolean }>>([])
  const [points, setPoints] = useState<AdminRuleDetail[]>([])
  const [sunk, setSunk] = useState<AdminRuleDetail[]>([])
  const [sets, setSets] = useState<AdminConfigurationDetail[]>([])
  const [materialDetail, setMaterialDetail] = useState<AdminMaterialDetail | null>(null)
  const [ruleDetail, setRuleDetail] = useState<AdminRuleDetail | null>(null)
  const [setDetail, setSetDetail] = useState<AdminConfigurationDetail | null>(null)
  const [cloneId, setCloneId] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [cloneSource, setCloneSource] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refreshLists = useCallback(async () => {
    const [materialPage, pointPage, sunkPage, configPage] = await Promise.all([
      adminConfigurationApi.listMaterials(), adminConfigurationApi.listPointRules(),
      adminConfigurationApi.listSunkRules(), adminConfigurationApi.listConfigurations(),
    ])
    setMaterials(materialPage.items); setPoints(pointPage.items); setSunk(sunkPage.items); setSets(configPage.items)
  }, [])

  useEffect(() => { void refreshLists().catch((failure) => setError(failure instanceof Error ? failure.message : '配置读取失败。')) }, [refreshLists])

  const reloadCurrent = async () => {
    await refreshLists()
    if (materialDetail) setMaterialDetail(await adminConfigurationApi.getMaterial(materialDetail.version))
    if (ruleDetail && tab === 'points') setRuleDetail(await adminConfigurationApi.getPointRule(ruleDetail.version))
    if (ruleDetail && tab === 'sunk') setRuleDetail(await adminConfigurationApi.getSunkRule(ruleDetail.version))
    if (setDetail) setSetDetail(await adminConfigurationApi.getConfiguration(setDetail.configSetId))
  }

  const sourceOptions = tab === 'materials' ? materials.filter(({ status }) => status === 'published').map(({ version }) => version)
    : tab === 'points' ? points.filter(({ status }) => status === 'published').map(({ version }) => version)
      : tab === 'sunk' ? sunk.filter(({ status }) => status === 'published').map(({ version }) => version)
        : sets.filter(({ status }) => status === 'published').map(({ configSetId }) => configSetId)

  const clone = async () => {
    setError(null)
    try {
      if (tab === 'materials') await adminConfigurationApi.cloneMaterial({ version: cloneId, displayName: cloneName, cloneFromVersion: cloneSource })
      if (tab === 'points') await adminConfigurationApi.clonePointRule({ version: cloneId, displayName: cloneName, cloneFromVersion: cloneSource })
      if (tab === 'sunk') await adminConfigurationApi.cloneSunkRule({ version: cloneId, displayName: cloneName, cloneFromVersion: cloneSource })
      if (tab === 'sets') await adminConfigurationApi.cloneConfiguration({ configSetId: cloneId, displayName: cloneName, cloneFromConfigSetId: cloneSource })
      setCloneId(''); setCloneName(''); await refreshLists()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '克隆失败。') }
  }

  const active = sets.find(({ active }) => active)
  return <section className="admin-configuration-console" data-testid="admin-configuration-console">
    <header><span className="eyebrow">EXPERIMENT CONFIGURATION</span><h2>实验配置管理</h2><p>发布与激活相互独立；既有正式会话始终保留创建时绑定的版本。</p></header>
    <nav className="admin-config-tabs" aria-label="实验配置栏目">
      {([['active', '当前生效配置'], ['materials', '候选人材料'], ['points', '点数规则'], ['sunk', '沉没成本规则'], ['sets', '配置集合']] as const).map(([id, label]) =>
        <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setMaterialDetail(null); setRuleDetail(null); setSetDetail(null) }}>{label}</button>)}
    </nav>
    {error && <p className="form-error" role="alert">{error}</p>}
    {tab === 'active' && <div className="admin-active-config">
      <h3>{active?.displayName ?? '暂无生效配置'}</h3>
      {active && <dl><div><dt>配置 ID</dt><dd>{active.configSetId}</dd></div><div><dt>材料</dt><dd>{active.materialVersion}</dd></div><div><dt>点数</dt><dd>{active.pointRuleVersion}</dd></div><div><dt>沉没成本</dt><dd>{active.sunkCostRuleVersion}</dd></div><div><dt>评分 / 基准</dt><dd>{active.scoringVersion} / {active.benchmarkVersion}</dd></div></dl>}
    </div>}
    {tab !== 'active' && <>
      <section className="admin-config-clone">
        <h3>从已发布版本克隆草稿</h3>
        <input aria-label="新版本 ID" placeholder="新版本 ID" value={cloneId} onChange={(event) => setCloneId(event.target.value)} />
        <input aria-label="显示名称" placeholder="显示名称" value={cloneName} onChange={(event) => setCloneName(event.target.value)} />
        <select aria-label="来源版本" value={cloneSource} onChange={(event) => setCloneSource(event.target.value)}><option value="">选择来源版本</option>{sourceOptions.map((version) => <option key={version}>{version}</option>)}</select>
        <button disabled={!cloneId || !cloneName || !cloneSource} onClick={() => void clone()}>创建草稿</button>
      </section>
      <div className="admin-config-workspace"><aside className="admin-config-list">
        {tab === 'materials' && materials.map((item) => <button key={item.version} onClick={() => void adminConfigurationApi.getMaterial(item.version).then(setMaterialDetail)}><strong>{item.version}</strong><span>{item.status} · r{item.revision}</span></button>)}
        {tab === 'points' && points.map((item) => <button key={item.version} onClick={() => void adminConfigurationApi.getPointRule(item.version).then(setRuleDetail)}><strong>{item.version}</strong><span>{item.status} · r{item.revision}</span></button>)}
        {tab === 'sunk' && sunk.map((item) => <button key={item.version} onClick={() => void adminConfigurationApi.getSunkRule(item.version).then(setRuleDetail)}><strong>{item.version}</strong><span>{item.status} · r{item.revision}</span></button>)}
        {tab === 'sets' && sets.map((item) => <button key={item.configSetId} onClick={() => void adminConfigurationApi.getConfiguration(item.configSetId).then(setSetDetail)}><strong>{item.configSetId}</strong><span>{item.active ? '当前生效' : item.status} · r{item.revision}</span></button>)}
      </aside><div className="admin-config-detail">
        {tab === 'materials' && materialDetail && <AdminMaterialEditor detail={materialDetail} onReload={reloadCurrent} />}
        {tab === 'points' && ruleDetail && <AdminRuleEditor kind="point" detail={ruleDetail} onReload={reloadCurrent} />}
        {tab === 'sunk' && ruleDetail && <AdminRuleEditor kind="sunk" detail={ruleDetail} onReload={reloadCurrent} />}
        {tab === 'sets' && setDetail && <AdminConfigurationSetEditor detail={setDetail} activeConfiguration={active ?? null} materials={materials} pointRules={points} sunkRules={sunk} onReload={reloadCurrent} />}
        {!materialDetail && !ruleDetail && !setDetail && <p className="empty-state">请选择一个版本查看详情。</p>}
      </div></div>
    </>}
  </section>
}
