import { useState } from 'react'
import {
  defaultTaskExperience,
  taskExperienceGroups,
} from '../data/researchFlow'
import type { TaskExperienceData } from '../types/game'
import {
  findFirstUnanswered,
  isQuestionnaireComplete,
  normalizeTaskExperience,
} from '../utils/researchData'
import { ScaleQuestion } from './ScaleQuestion'

type Props = {
  initialValue?: TaskExperienceData | null
  onBack: () => void
  onSubmit: (value: TaskExperienceData) => void
}

export function TaskExperienceScreen({
  initialValue,
  onBack,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<TaskExperienceData>(
    initialValue ?? defaultTaskExperience,
  )
  const [showValidation, setShowValidation] = useState(false)
  const firstUnanswered = findFirstUnanswered(values)

  const submit = () => {
    if (!isQuestionnaireComplete(values)) {
      setShowValidation(true)
      if (firstUnanswered) {
        document.getElementById(`experience-${firstUnanswered}`)?.focus()
      }
      return
    }

    onSubmit(normalizeTaskExperience(values))
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
          {showValidation && (
            <p className="research-validation" role="alert">
              请完成所有题目后再生成报告。
            </p>
          )}
          {taskExperienceGroups.map((group) => (
            <section key={group.title} className="experience-group">
              <h2>{group.title}</h2>
              <div className="scale-stack">
                {group.items.map((item) => (
                  <ScaleQuestion
                    key={item.id}
                    id={`experience-${item.id}`}
                    label={item.label}
                    value={values[item.id]}
                    invalid={showValidation && values[item.id] === null}
                    min={item.min}
                    max={item.max}
                    leftLabel={
                      item.min === 0 ? '0=完全没有信心' : '1=完全不同意'
                    }
                    rightLabel={
                      item.min === 0 ? '10=非常有信心' : '10=完全同意'
                    }
                    onChange={(value) =>
                      setValues((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="research-actions">
          <button className="button button--ghost" onClick={onBack}>
            返回
          </button>
          <button
            className="button button--primary"
            onClick={submit}
          >
            生成抗压决策报告
          </button>
        </div>
      </section>
    </main>
  )
}
