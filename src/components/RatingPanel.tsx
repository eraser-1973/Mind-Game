import { useEffect, useState } from 'react'
import type {
  CandidateRuntimeState,
  RatingStage,
} from '../types/game'

type Props = {
  candidateId: string
  runtime: CandidateRuntimeState
  onRate: (stage: RatingStage, value: number) => void
}

const nextStage = (
  runtime: CandidateRuntimeState,
): RatingStage | null => {
  if (!runtime.ratings.T1) return 'T1'
  if (runtime.shallowUnlocked && !runtime.ratings.T2) return 'T2'
  if (runtime.deepUnlocked && !runtime.ratings.T3) return 'T3'
  return null
}

const stageCopy = {
  T1: ['简历首屏初评', '仅依据当前可见简历作出第一判断。'],
  T2: ['浅查后重评', '上次分数已隐藏，请只依据现在掌握的信息。'],
  T3: ['深查后终评', '历史评分保持封存，提交你的最终证据判断。'],
}

export function RatingPanel({
  candidateId,
  runtime,
  onRate,
}: Props) {
  const stage = nextStage(runtime)
  const [value, setValue] = useState(50)

  useEffect(() => {
    setValue(50)
  }, [candidateId, stage])

  return (
    <section className="rating-panel">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">判断校准</span>
          <h3>{stage ? stageCopy[stage][0] : '当前评分已完成'}</h3>
        </div>
        <div className="rating-stamps" aria-label="评分阶段状态">
          {(['T1', 'T2', 'T3'] as RatingStage[]).map((item) => (
            <span
              key={item}
              className={runtime.ratings[item] ? 'is-sealed' : ''}
            >
              {item} {runtime.ratings[item] ? '已封存' : ''}
            </span>
          ))}
        </div>
      </div>
      {stage ? (
        <>
          <p>{stageCopy[stage][1]}</p>
          <div className="rating-control">
            <span>0</span>
            <input
              aria-label={stage + ' 评分'}
              type="range"
              min="0"
              max="100"
              value={value}
              onChange={(event) => setValue(Number(event.target.value))}
            />
            <span>100</span>
            <output>{value}</output>
          </div>
          <button
            className="button button--compact"
            onClick={() => onRate(stage, value)}
          >
            提交并封存 {stage}
          </button>
        </>
      ) : (
        <p className="empty-state">
          已解锁证据对应的评分均已封存。继续查证，或比较其他候选人。
        </p>
      )}
    </section>
  )
}
