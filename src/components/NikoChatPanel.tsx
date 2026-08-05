import { useEffect, useRef } from 'react'
import type { NikoMessage } from '../types/game'
import { NikoMessageBubble } from './NikoMessageBubble'

type Props = {
  messages: NikoMessage[]
  mode?: 'quick' | 'formal'
}

export function NikoChatPanel({ messages, mode = 'quick' }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  const neutralMode = mode === 'formal'
  const displayedMessages = neutralMode
    ? messages.map((message) => ({ ...message, mood: 'neutral' as const }))
    : messages

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayedMessages.length, displayedMessages.at(-1)?.timestamp])

  return (
    <aside className={`niko-chat-panel panel${neutralMode ? ' niko-chat-panel--neutral' : ''}`}>
      <div className="niko-chat-panel__heading">
        <div>
          <span className="eyebrow">即时反馈</span>
          <h2>Niko 对话</h2>
        </div>
        <span className="niko-status">ONLINE</span>
      </div>
      <div className="niko-chat-stream" aria-live="polite">
        <div className="niko-welcome">
          {neutralMode
            ? 'Niko 会记录你对当前材料作出的评分调整。'
            : 'Niko会根据你对证据的判断，实时给出反馈。'}
        </div>
        {displayedMessages.map((message) => (
          <NikoMessageBubble key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>
    </aside>
  )
}
