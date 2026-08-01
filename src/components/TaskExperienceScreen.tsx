import { useState } from 'react'
import { taskExperienceGroups } from '../data/researchFlow'
import type {
  TaskExperienceData,
  TaskExperienceId,
} from '../types/game'
import { normalizeTaskExperience } from '../utils/researchData'
import { ScaleQuestion } from './ScaleQuestion'

type Props = {
  initialValue?: TaskExperienceData | null
  onBack?: () => void
  onSubmit: (
    value: TaskExperienceData,
    metadata: {
      touched: Record<TaskExperienceId, true>
      submittedAt: string
    },
  ) => void | Promise<void>
}

export function TaskExperienceScreen({
  initialValue,
  onBack,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<Partial<TaskExperienceData>>(
    initialValue ?? {},
  )
  const [touched, setTouched] = useState<Partial<Record<TaskExperienceId, true>>>(
    initialValue
      ? Object.fromEntries(taskExperienceGroups.flatMap((group) =>
          group.items.map((item) => [item.id, true])))
      : {},
  )
  const [firstMissingId, setFirstMissingId] = useState<TaskExperienceId | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const items = taskExperienceGroups.flatMap((group) => group.items)
    const missing = items.find((item) => touched[item.id] !== true)
    if (missing) {
      setFirstMissingId(missing.id)
      setSubmitError('请主动完成全部 15 项评分后再提交。')
      return
    }
    const completed = Object.fromEntries(items.map((item) => [
      item.id,
      values[item.id],
    ])) as TaskExperienceData
    const completedTouched = Object.fromEntries(items.map((item) => [
      item.id,
      true,
    ])) as Record<TaskExperienceId, true>
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(normalizeTaskExperience(completed), {
        touched: completedTouched,
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
      <section className="research-card research-card--wide">
        <span className="eyebrow">MANIPULATION CHECK</span>
        <h1>任务体验与压力操纵检验</h1>
        <p className="research-card__lead">
          评分方式：1—10分同意度评分。1=完全不同意，10=完全同意。最终决策信心为0—10分。
        </p>

        <div className="experience-groups">
          {taskExperienceGroups.map((group) => (
            <section key={group.title} className="experience-group">
              <h2>{group.title}</h2>
              <div className="scale-stack">
                {group.items.map((item) => (
                  <ScaleQuestion
                    key={item.id}
                    id={`experience-${item.id}`}
                    label={item.label}
                    value={values[item.id] ?? null}
                    min={item.min}
                    max={item.max}
                    leftLabel={
                      item.min === 0 ? '0=完全没有信心' : '1=完全不同意'
                    }
                    rightLabel={
                      item.min === 0 ? '10=非常有信心' : '10=完全同意'
                    }
                    touched={touched[item.id] === true}
                    invalid={firstMissingId === item.id}
                    autoFocus={firstMissingId === item.id}
                    onChange={(value) => {
                      setValues((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                      setTouched((current) => ({ ...current, [item.id]: true }))
                      if (firstMissingId === item.id) setFirstMissingId(null)
                      setSubmitError(null)
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {submitError && <p className="form-error" role="alert">{submitError}</p>}

        <div className="research-actions">
          {onBack && <button className="button button--ghost" onClick={onBack}>
            返回
          </button>}
          <button
            className="button button--primary"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? '正在保存…' : '提交任务体验'}
          </button>
        </div>
      </section>
    </main>
  )
}
