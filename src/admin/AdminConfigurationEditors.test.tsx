import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminConfigurationSetEditor } from './AdminConfigurationSetEditor'
import { AdminRuleEditor } from './AdminRuleEditors'
import type { AdminConfigurationDetail, AdminRuleDetail } from './adminTypes'

const report = { errors: [], warnings: [] }
const active: AdminConfigurationDetail = {
  configSetId: 'config-active', displayName: '当前配置', sourceConfigSetId: null,
  status: 'published', active: true, revision: 1, validationStatus: 'valid',
  validationReport: report, fingerprint: 'a'.repeat(64), taskVersion: 'task-1.0.0',
  materialVersion: 'material-old', pointRuleVersion: 'points-old',
  sunkCostRuleVersion: 'sunk-old', scoringVersion: 'scoring-old',
  benchmarkVersion: 'benchmark-old', normVersion: null,
  publishedAt: '2026-08-01T00:00:00.000Z', activatedAt: '2026-08-01T00:00:00.000Z',
}
const rollbackTarget: AdminConfigurationDetail = {
  ...active, configSetId: 'config-rollback', displayName: '回滚目标', active: false,
  materialVersion: 'material-new', pointRuleVersion: 'points-new',
  sunkCostRuleVersion: 'sunk-new', scoringVersion: 'scoring-new',
  benchmarkVersion: 'benchmark-new', activatedAt: '2026-07-01T00:00:00.000Z',
}

let renderer: ReactTestRenderer | undefined
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined })

describe('administrator configuration editors', () => {
  it('shows activation differences and requires the exact target ID for rollback activation', async () => {
    await act(async () => {
      renderer = create(<AdminConfigurationSetEditor
        detail={rollbackTarget} activeConfiguration={active}
        materials={[]} pointRules={[]} sunkRules={[]} onReload={vi.fn()}
      />)
    })
    const text = JSON.stringify(renderer!.toJSON())
    expect(text).toContain('回滚激活确认')
    expect(text).toContain('material-old')
    expect(text).toContain('material-new')
    const activation = renderer!.root.findAllByType('button').find((button) => button.children.join('') === '激活配置')!
    expect(activation.props.disabled).toBe(true)
    const confirmInput = renderer!.root.findAllByType('input').find((input) => input.props.disabled !== true)!
    await act(async () => confirmInput.props.onChange({ target: { value: rollbackTarget.configSetId } }))
    expect(renderer!.root.findAllByType('input').find((input) => input.props.disabled !== true)!.props.value).toBe(rollbackTarget.configSetId)
    expect(renderer!.root.findAllByType('button').find((button) => button.children.join('') === '激活配置')!.props.disabled).toBe(false)
  })

  it('keeps published rules read-only and renders validation errors next to the editor', () => {
    const pointRule: AdminRuleDetail = {
      version: 'points-readonly', displayName: '只读规则', sourceVersion: 'points-5-v1',
      status: 'published', revision: 2, validationStatus: 'invalid', fingerprint: null,
      publishedAt: '2026-08-01T00:00:00.000Z', rule: { totalPoints: 1, shallowCost: 1, deepCost: 1 },
      validationReport: { errors: [{ code: 'POINT_TOTAL_INSUFFICIENT', path: 'totalPoints', message: 'invalid' }], warnings: [] },
    }
    renderer = create(<AdminRuleEditor kind="point" detail={pointRule} onReload={vi.fn()} />)
    expect(renderer.root.findAllByType('input').every((input) => input.props.disabled)).toBe(true)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('POINT_TOTAL_INSUFFICIENT')
    expect(renderer.root.findAllByType('button').every((button) => button.props.disabled)).toBe(true)
  })
})
