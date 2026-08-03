import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listMaterials: vi.fn(), listPointRules: vi.fn(), listSunkRules: vi.fn(), listConfigurations: vi.fn(),
  getMaterial: vi.fn(), getPointRule: vi.fn(), getSunkRule: vi.fn(), getConfiguration: vi.fn(),
  cloneMaterial: vi.fn(), clonePointRule: vi.fn(), cloneSunkRule: vi.fn(), cloneConfiguration: vi.fn(),
  updateMaterial: vi.fn(), validateMaterial: vi.fn(), publishMaterial: vi.fn(),
  updatePointRule: vi.fn(), updateSunkRule: vi.fn(), validatePointRule: vi.fn(), validateSunkRule: vi.fn(),
  publishPointRule: vi.fn(), publishSunkRule: vi.fn(), updateConfiguration: vi.fn(),
  validateConfiguration: vi.fn(), publishConfiguration: vi.fn(), activateConfiguration: vi.fn(),
}))

vi.mock('./adminApi', async () => {
  const actual = await vi.importActual<typeof import('./adminApi')>('./adminApi')
  return { ...actual, adminConfigurationApi: api }
})

import { AdminConfigurationConsole } from './AdminConfigurationConsole'
import { AdminMaterialEditor } from './AdminMaterialEditor'

const material = {
  version: 'material-1.0.0', displayName: '当前五名候选人材料', status: 'published' as const,
  sourceVersion: null, revision: 1, validationStatus: 'valid' as const,
  validationReport: { errors: [], warnings: [] }, fingerprint: 'a'.repeat(64), publishedAt: '2026-08-03T00:00:00.000Z',
  profiles: ['A', 'B', 'C', 'D', 'E'].map((candidateId, index) => ({
    candidateId, displayOrder: index + 1, name: `候选人 ${candidateId}`, role: '岗位', school: '学校',
    visibleHalo: ['光环'], resumeSummary: '摘要', education: '教育', skills: ['技能'],
    experiences: [{ title: '经历', content: '内容' }], initialImage: '形象', publicTags: ['标签'],
  })),
  evidence: ['A', 'B', 'C', 'D', 'E'].flatMap((candidateId) => ['shallow', 'deep'].flatMap((level) => [1, 2].map((order) => ({
    evidenceId: `${candidateId}-${level}-${order}`, candidateId, level: level as 'shallow' | 'deep', order,
    title: '证据', content: '正文', polarity: 'positive' as const, isKeyRisk: candidateId === 'A' && order === 1,
  })))),
}

const config = {
  configSetId: 'config-2026-07-v1', displayName: '当前正式预实验配置', sourceConfigSetId: null,
  status: 'published' as const, active: true, revision: 1, validationStatus: 'valid' as const,
  validationReport: { errors: [], warnings: [] }, fingerprint: 'd'.repeat(64), taskVersion: 'task-1.0.0',
  materialVersion: material.version, pointRuleVersion: 'points-5-v1', sunkCostRuleVersion: 'sunk-1.0.0',
  scoringVersion: 'RDI-2.0-prepilot', benchmarkVersion: 'benchmark-1.0.0', normVersion: null,
  publishedAt: '2026-08-03T00:00:00.000Z', activatedAt: '2026-08-03T00:00:00.000Z',
}

let renderer: ReactTestRenderer | undefined

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset())
  api.listMaterials.mockResolvedValue({ items: [{ ...material, usedByActiveConfig: true }] })
  api.listPointRules.mockResolvedValue({ items: [] })
  api.listSunkRules.mockResolvedValue({ items: [] })
  api.listConfigurations.mockResolvedValue({ items: [config] })
  api.getMaterial.mockResolvedValue(material)
})

afterEach(() => { act(() => renderer?.unmount()); renderer = undefined })

describe('administrator configuration console', () => {
  it('shows the active configuration and only the approved Stage 10A navigation', async () => {
    await act(async () => { renderer = create(<AdminConfigurationConsole />) })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('当前生效配置')
    expect(text).toContain('候选人材料')
    expect(text).toContain('点数规则')
    expect(text).toContain('沉没成本规则')
    expect(text).not.toMatch(/参与者身份|专家评分编辑|norm 编辑|CSV|删除/)
  })

  it('opens published materials read-only without exposing hidden answer fields', async () => {
    await act(async () => { renderer = create(<AdminConfigurationConsole />) })
    act(() => renderer!.root.findAllByType('button').find((button) => button.children.includes('候选人材料'))!.props.onClick())
    const materialButton = renderer!.root.findAllByType('button').find((button) =>
      button.findAllByType('strong').some((label) => label.children.join('') === material.version),
    )
    await act(async () => materialButton!.props.onClick())
    const editor = renderer!.root.findByType(AdminMaterialEditor)
    expect(editor.props.detail.status).toBe('published')
    const serialized = JSON.stringify(renderer!.toJSON())
    expect(serialized).not.toMatch(/trueAbility|trueFit|isToxic|riskFlags|baselineFitScore|dimensionScores/)
    expect(renderer!.root.findAllByType('fieldset').every((fieldset) => fieldset.props.disabled)).toBe(true)
  })
})
