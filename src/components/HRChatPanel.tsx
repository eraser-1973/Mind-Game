import { useEffect, useMemo, useRef } from 'react'
import type { ChatMessage } from '../types/game'
import { formatTime } from '../utils/time'

type Props = {
  chats: ChatMessage[]
  elapsedSec: number
}

const scheduledMessages: ChatMessage[] = [
  {
    id: 'scheduled-zhang',
    sender: '小张',
    content:
      '这5份简历是昨晚人力加急筛出来的。你抓紧时间，我只看最终结果。',
    elapsedSec: 15,
    tone: 'urgent',
  },
  {
    id: 'scheduled-li',
    sender: '李姐',
    content:
      '提醒一下，附件里有些材料可能比首页更值得看。你有5个点数，别一开始就全用了。',
    elapsedSec: 45,
    tone: 'neutral',
  },
  {
    id: 'scheduled-wang',
    sender: '王总',
    content:
      '对了，招进来的人是要跟我做项目的。不要只看学校排名，我要的是能干活的人。',
    elapsedSec: 90,
    tone: 'urgent',
  },
]

export function HRChatPanel({ chats, elapsedSec }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  const visibleMessages = useMemo(() => {
    const unlockedScheduled = scheduledMessages.filter(
      (message) => elapsedSec >= message.elapsedSec,
    )

    return [...unlockedScheduled, ...chats]
  }, [chats, elapsedSec])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [visibleMessages.length])

  return (
    <aside className="chat-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LIVE CHANNEL</span>
          <h2>HR 评议流</h2>
        </div>
        <span className="live-badge">LIVE</span>
      </div>
      <div className="chat-stream" aria-live="polite">
        {visibleMessages.length === 0 && (
          <p className="chat-placeholder">等待 HR 消息…</p>
        )}
        {visibleMessages.map((chat) => (
          <article
            key={chat.id}
            className={'chat-message chat-message--' + chat.tone}
          >
            <div className="chat-message__avatar">
              {chat.sender.slice(0, 1)}
            </div>
            <div>
              <header>
                <strong>{chat.sender}</strong>
                <time>{formatTime(chat.elapsedSec)}</time>
              </header>
              <p>{chat.content}</p>
            </div>
          </article>
        ))}
        <div ref={endRef} />
      </div>
      <footer className="chat-footer">
        <span className="status-dot" />
        社会评价压力通道已接入
      </footer>
    </aside>
  )
}
