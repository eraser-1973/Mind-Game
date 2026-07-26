import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./RecruitmentCabin3D', () => ({
  RecruitmentCabin3D: () => <div />,
}))

import { StartScreen } from './StartScreen'

describe('StartScreen job briefing', () => {
  it('introduces the AI assessment product assistant role, responsibilities and player task', () => {
    const html = renderToStaticMarkup(
      <StartScreen onStart={() => undefined} />,
    )

    expect(html).toContain('AI测评产品助理（实习生）')
    expect(html).toContain('岗位职责')
    expect(html).toContain('玩家任务')
  })
})
