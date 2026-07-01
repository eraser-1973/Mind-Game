import { useEffect, useRef } from 'react'
import type { NikoMessage } from '../types/game'
import { NikoMessageBubble } from './NikoMessageBubble'

type Props = {
  messages: NikoMessage[]
}

export function NikoChatPanel({ messages }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages.at(-1)?.timestamp])

  return (
    <aside className="niko-chat-panel panel">
      <div className="niko-chat-panel__heading">
        <div>
          <span className="eyebrow">即时反馈</span>
          <h2>Niko 对话</h2>
        </div>
        <span className="niko-status">ONLINE</span>
      </div>
      <div className="niko-chat-stream" aria-live="polite">
        <div className="niko-welcome">
          Niko会根据你对证据的判断，实时给出反馈。
        </div>
        {messages.map((message) => (
          <NikoMessageBubble key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>
    </aside>
  )
}
