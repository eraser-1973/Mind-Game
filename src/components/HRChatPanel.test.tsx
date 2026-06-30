import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types/game'
import { HRChatPanel } from './HRChatPanel'

const renderPanel = (elapsedSec: number, chats: ChatMessage[] = []) =>
  renderToStaticMarkup(
    <HRChatPanel chats={chats} elapsedSec={elapsedSec} />,
  )

describe('HRChatPanel', () => {
  it('shows a waiting state before scheduled HR messages begin', () => {
    const html = renderPanel(14)

    expect(html).toContain('等待 HR 消息')
    expect(html).not.toContain('小张')
    expect(html).not.toContain('李姐')
    expect(html).not.toContain('王总')
  })

  it('reveals scheduled HR messages progressively at 15, 45, and 90 seconds', () => {
    const at15 = renderPanel(15)
    expect(at15).toContain('小张')
    expect(at15).toContain('00:15')
    expect(at15).not.toContain('李姐')
    expect(at15).not.toContain('王总')

    const at45 = renderPanel(45)
    expect(at45).toContain('小张')
    expect(at45).toContain('李姐')
    expect(at45).toContain('00:45')
    expect(at45).not.toContain('王总')
    expect(at45.indexOf('小张')).toBeLessThan(at45.indexOf('李姐'))

    const at90 = renderPanel(90)
    expect(at90).toContain('小张')
    expect(at90).toContain('李姐')
    expect(at90).toContain('王总')
    expect(at90).toContain('01:30')
    expect(at90.indexOf('小张')).toBeLessThan(at90.indexOf('李姐'))
    expect(at90.indexOf('李姐')).toBeLessThan(at90.indexOf('王总'))
  })
})
