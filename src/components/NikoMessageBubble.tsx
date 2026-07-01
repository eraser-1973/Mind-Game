import type { NikoMessage, NikoMood } from '../types/game'
import { formatTime } from '../utils/time'

const avatarByMood: Record<NikoMood, string> = {
  happy: '/assets/niko-happy.png',
  angry: '/assets/niko-angry.png',
}

const moodLabel: Record<NikoMood, string> = {
  happy: '开心',
  angry: '愤怒',
}

type Props = {
  message: NikoMessage
}

export function NikoMessageBubble({ message }: Props) {
  return (
    <article className={`niko-message niko-message--${message.mood}`}>
      <img
        className="niko-message__avatar"
        src={avatarByMood[message.mood]}
        alt={`Niko ${moodLabel[message.mood]}`}
        width="40"
        height="40"
      />
      <div className="niko-message__body">
        <header>
          <strong>Niko</strong>
          <span className="niko-message__mood">
            {moodLabel[message.mood]}
          </span>
          <time>{formatTime(message.timestamp)}</time>
        </header>
        <p>{message.text}</p>
      </div>
    </article>
  )
}
