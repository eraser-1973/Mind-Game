import { useState } from 'react'
import {
  defaultStateAssessment,
  stateAssessmentItems,
} from '../data/researchFlow'
import type { StateAssessmentData } from '../types/game'
import { normalizeStateAssessment } from '../utils/researchData'
import { ScaleQuestion } from './ScaleQuestion'

type Props = {
  title: '当前状态评估' | '任务后状态评估'
  phase: 'before' | 'after'
  initialValue?: StateAssessmentData | null
  onBack?: () => void
  onSubmit: (value: StateAssessmentData) => void
}

export function StateAssessmentScreen({
  title,
  phase,
  initialValue,
  onBack,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<StateAssessmentData>(
    initialValue ?? defaultStateAssessment,
  )
  const instruction =
    phase === 'before'
      ? '在开始任务前，请根据您此刻的真实感受进行评价。答案没有对错，仅用于后续数据分析。'
      : '请根据完成任务后的真实感受进行评价。'

  return (
    <main className="research-screen">
      <section className="research-card">
        <span className="eyebrow">
          {phase === 'before' ? 'BEFORE TASK' : 'AFTER TASK'}
        </span>
        <h1>{title}</h1>
        <p className="research-card__lead">
          {instruction} 评分方式：0—10分滑动评分。
        </p>

        <div className="scale-stack">
          {stateAssessmentItems.map((item) => (
            <ScaleQuestion
              key={item.id}
              id={`${phase}-${item.id}`}
              label={item.label}
              value={values[item.id]}
              min={0}
              max={10}
              leftLabel="0=完全没有"
              rightLabel="10=非常强烈"
              onChange={(value) =>
                setValues((current) => ({
                  ...current,
                  [item.id]: value,
                }))
              }
            />
          ))}
        </div>

        <div className="research-actions">
          {onBack && (
            <button className="button button--ghost" onClick={onBack}>
              返回
            </button>
          )}
          <button
            className="button button--primary"
            onClick={() => onSubmit(normalizeStateAssessment(values))}
          >
            {phase === 'before' ? '进入招聘决策任务' : '继续'}
          </button>
        </div>
      </section>
    </main>
  )
}
