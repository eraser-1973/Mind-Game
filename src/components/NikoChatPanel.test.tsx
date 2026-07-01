import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NikoMessage } from '../types/game'
import { NikoChatPanel } from './NikoChatPanel'

const messages: NikoMessage[] = [
  {
    id: 'happy-message',
    candidateId: 'C',
    stage: 'T2',
    mood: 'happy',
    text: '你抓住了过程记录完整这个稳定信号。',
    relatedEvidenceId: 'C-shallow',
    timestamp: 20,
  },
  {
    id: 'angry-message',
    candidateId: 'A',
    stage: 'T2',
    mood: 'angry',
    text: '你忽略了贡献边界模糊这个风险。',
    relatedEvidenceId: 'A-shallow',
    timestamp: 25,
  },
]

describe('NikoChatPanel', () => {
  it('renders the welcome copy, both real avatar paths, and feedback text', () => {
    const html = renderToStaticMarkup(
      <NikoChatPanel messages={messages} />,
    )

    expect(html).toContain('即时反馈')
    expect(html).toContain('Niko 对话')
    expect(html).toContain(
      'Niko会根据你对证据的判断，实时给出反馈。',
    )
    expect(html).toContain('/assets/niko-happy.png')
    expect(html).toContain('/assets/niko-angry.png')
    expect(html).toContain('你抓住了过程记录完整这个稳定信号。')
    expect(html).toContain('aria-live="polite"')
  })
})
