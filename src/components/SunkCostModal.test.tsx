import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SunkCostModal } from './SunkCostModal'

describe('SunkCostModal', () => {
  it('renders all three choices with the same button structure and class weight', () => {
    const html = renderToStaticMarkup(
      <SunkCostModal candidateName="候选人 A" spentPoints={4} onChoose={() => undefined} />,
    )
    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html).toContain('追加验证')
    expect(html).toContain('立即止损')
    expect(html).toContain('放弃本轮补录')
    expect(html).not.toMatch(/button--primary|button--danger|is-recommended/)
    expect(html).not.toContain('明显风险')
  })
})
