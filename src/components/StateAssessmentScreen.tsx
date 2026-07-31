import { useState } from 'react'
import {
  stateAssessmentItems,
} from '../data/researchFlow'
import type { StateAssessmentData, StateAssessmentId } from '../types/game'
import { normalizeStateAssessment } from '../utils/researchData'
import { ScaleQuestion } from './ScaleQuestion'

type Props = {
  title: '当前状态评估' | '任务后状态评估'
  phase: 'before' | 'after'
  initialValue?: StateAssessmentData | null
  onBack?: () => void
  onSubmit: (
    value: StateAssessmentData,
    metadata: {
      touched: Record<StateAssessmentId, true>
      startedAt: string
      submittedAt: string
    },
  ) => void | Promise<void>
}

export function StateAssessmentScreen({
  title,
  phase,
  initialValue,
  onBack,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<Partial<StateAssessmentData>>(
    initialValue ?? {},
  )
  const [touched, setTouched] = useState<Partial<Record<StateAssessmentId, true>>>(
    initialValue
      ? Object.fromEntries(stateAssessmentItems.map((item) => [item.id, true]))
      : {},
  )
  const [startedAt] = useState(() => new Date().toISOString())
  const [firstMissingId, setFirstMissingId] = useState<StateAssessmentId | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const instruction =
    phase === 'before'
      ? '在开始任务前，请根据您此刻的真实感受进行评价。答案没有对错，仅用于后续数据分析。'
      : '请根据完成任务后的真实感受进行评价。'

  const submit = async () => {
    const missing = stateAssessmentItems.find((item) => touched[item.id] !== true)
    if (missing) {
      setFirstMissingId(missing.id)
      setSubmitError('请主动完成全部 5 项评分后再继续。')
      return
    }

    const completed = Object.fromEntries(
      stateAssessmentItems.map((item) => [item.id, values[item.id]]),
    ) as StateAssessmentData
    const completedTouched = Object.fromEntries(
      stateAssessmentItems.map((item) => [item.id, true]),
    ) as Record<StateAssessmentId, true>
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(normalizeStateAssessment(completed), {
        touched: completedTouched,
        startedAt,
        submittedAt: new Date().toISOString(),
      })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '提交失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

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
              value={values[item.id] ?? null}
              min={0}
              max={10}
              leftLabel="0=完全没有"
              rightLabel="10=非常强烈"
              touched={touched[item.id] === true}
              invalid={firstMissingId === item.id}
              autoFocus={firstMissingId === item.id}
              onChange={(value) => {
                setValues((current) => ({ ...current, [item.id]: value }))
                setTouched((current) => ({ ...current, [item.id]: true }))
                if (firstMissingId === item.id) setFirstMissingId(null)
                setSubmitError(null)
              }}
            />
          ))}
        </div>

        {submitError && <p className="form-error" role="alert">{submitError}</p>}

        <div className="research-actions">
          {onBack && (
            <button className="button button--ghost" onClick={onBack}>
              返回
            </button>
          )}
          <button
            className="button button--primary"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? '正在保存…' : phase === 'before' ? '进入招聘决策任务' : '继续'}
          </button>
        </div>
      </section>
    </main>
  )
}
