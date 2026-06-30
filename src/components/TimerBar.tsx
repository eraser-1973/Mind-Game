import type { GameState } from '../types/game'
import { formatTime, getPressureStage, isFinalWarning } from '../utils/time'

type Props = Pick<
  GameState,
  'timeLeftSec' | 'durationSec' | 'elapsedSec' | 'availablePoints' | 'mode'
>

const labels = {
  green: '信息采集期',
  orange: '压力升温期',
  red: '高压决断期',
}

export function TimerBar({
  timeLeftSec,
  durationSec,
  elapsedSec,
  availablePoints,
  mode,
}: Props) {
  const stage = getPressureStage(elapsedSec, durationSec)
  const warning = isFinalWarning(timeLeftSec, durationSec)
  const progress = (timeLeftSec / durationSec) * 100

  return (
    <header className={'timer-bar timer-bar--' + stage + (warning ? ' is-warning' : '')}>
      <div className="timer-bar__identity">
        <span className="status-dot" />
        <div>
          <span>招聘模拟舱 / {mode === 'quick' ? 'QUICK TEST' : 'FORMAL'}</span>
          <strong>{labels[stage]}</strong>
        </div>
      </div>
      <div className="timer-bar__clock" aria-live="polite">
        <small>剩余决策时间</small>
        <strong>{formatTime(timeLeftSec)}</strong>
      </div>
      <div className="timer-bar__resource">
        <span>查证资源</span>
        <strong>{availablePoints} / 5</strong>
      </div>
      <div className="timer-bar__track" aria-hidden="true">
        <span style={{ width: progress + '%' }} />
      </div>
    </header>
  )
}
