import { useState } from 'react'
import {
  defaultDemographics,
  demographicOptions,
} from '../data/researchFlow'
import type { DemographicData } from '../types/game'

type Props = {
  initialValue?: DemographicData | null
  onBack: () => void
  onSubmit: (value: DemographicData) => void
}

const fieldLabels = {
  ageRange: '年龄范围',
  gender: '性别',
  education: '当前学历',
  grade: '年级',
  majorCategory: '专业类别',
} as const

type SingleChoiceKey = keyof typeof fieldLabels

export function DemographicForm({
  initialValue,
  onBack,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<DemographicData>(
    initialValue ?? defaultDemographics,
  )

  const setSingleChoice = (
    key: SingleChoiceKey,
    value: DemographicData[SingleChoiceKey],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const toggleExperience = (
    value: DemographicData['relatedExperience'][number],
  ) => {
    setForm((current) => {
      if (value === '无相关经历') {
        return {
          ...current,
          relatedExperience: ['无相关经历'],
        }
      }

      const withoutNone = current.relatedExperience.filter(
        (item) => item !== '无相关经历',
      )
      const next = withoutNone.includes(value)
        ? withoutNone.filter((item) => item !== value)
        : [...withoutNone, value]

      return {
        ...current,
        relatedExperience: next.length ? next : ['无相关经历'],
      }
    })
  }

  return (
    <main className="research-screen">
      <section className="research-card research-card--wide">
        <span className="eyebrow">STEP 02 / OPTIONAL PROFILE</span>
        <h1>基本信息登记（匿名）</h1>
        <p className="research-card__lead">
          以下信息仅用于样本统计分析，不涉及个人身份识别。每一项都可以选择“不愿透露”或保持低敏匿名选项。
        </p>

        <div className="research-form-grid">
          {Object.entries(fieldLabels).map(([key, label]) => (
            <label key={key} className="research-field">
              <span>{label}</span>
              <select
                value={form[key as SingleChoiceKey]}
                onChange={(event) =>
                  setSingleChoice(
                    key as SingleChoiceKey,
                    event.target.value as DemographicData[SingleChoiceKey],
                  )
                }
              >
                {demographicOptions[key as SingleChoiceKey].map(
                  (option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ),
                )}
              </select>
            </label>
          ))}
        </div>

        <fieldset className="research-fieldset">
          <legend>相关经历（多选）</legend>
          <div className="choice-grid">
            {demographicOptions.relatedExperience.map((option) => (
              <label key={option} className="choice-chip">
                <input
                  type="checkbox"
                  checked={form.relatedExperience.includes(option)}
                  onChange={() => toggleExperience(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="research-actions">
          <button className="button button--ghost" onClick={onBack}>
            返回
          </button>
          <button
            className="button button--primary"
            onClick={() => onSubmit(form)}
          >
            继续
          </button>
        </div>
      </section>
    </main>
  )
}
