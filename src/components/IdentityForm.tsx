import { useMemo, useState, type FormEvent } from 'react'
import type { FormalIdentityInput } from '../types/game'

type Props = {
  onBack: () => void
  onSubmit: (identity: FormalIdentityInput) => Promise<void>
}

type IdentityValues = {
  fullName: string
  studentId: string
  phone: string
}

const PHONE_PATTERN = /^\+?[0-9]{6,20}$/

function normalizedPhone(value: string): string {
  return value.trim().replace(/[\s\-()]/gu, '')
}

export function validateIdentityForm(values: IdentityValues): {
  canSubmit: boolean
  phoneError: string | null
} {
  const fullName = values.fullName.trim().replace(/\s+/gu, ' ')
  const studentId = values.studentId.trim()
  const phone = values.phone.trim()
  const hasValue = Boolean(fullName || studentId || phone)
  const phoneError =
    phone && !PHONE_PATTERN.test(normalizedPhone(phone))
      ? '手机号格式不正确：请输入 6–20 位数字，可使用开头的 +、空格、短横线或括号。'
      : null
  const lengthsValid = fullName.length <= 100 && studentId.length <= 64

  return {
    canSubmit: hasValue && !phoneError && lengthsValid,
    phoneError,
  }
}

export function IdentityForm({ onBack, onSubmit }: Props) {
  const [values, setValues] = useState<IdentityValues>({
    fullName: '',
    studentId: '',
    phone: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const validation = useMemo(() => validateIdentityForm(values), [values])

  const setField = (key: keyof IdentityValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validation.canSubmit || submitting) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(values)
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message
          ? error.message
          : '暂时无法创建实验会话，请重试。',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="research-screen">
      <section className="research-card">
        <span className="eyebrow">FORMAL REGISTRATION</span>
        <h1>身份信息登记</h1>
        <p className="research-card__lead">
          姓名、学号、手机号至少填写一项。三项均为独立选填，仅用于参与登记、后续联系和数据核对。
        </p>

        <form className="identity-form" onSubmit={handleSubmit}>
          <label className="research-field">
            <span>姓名（选填）</span>
            <input
              name="fullName"
              autoComplete="name"
              maxLength={100}
              value={values.fullName}
              disabled={submitting}
              onChange={(event) => setField('fullName', event.target.value)}
            />
          </label>

          <label className="research-field">
            <span>学号（选填）</span>
            <input
              name="studentId"
              autoComplete="off"
              maxLength={64}
              value={values.studentId}
              disabled={submitting}
              onChange={(event) => setField('studentId', event.target.value)}
            />
          </label>

          <label className="research-field">
            <span>手机号（选填）</span>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              value={values.phone}
              disabled={submitting}
              aria-invalid={Boolean(validation.phoneError)}
              aria-describedby={validation.phoneError ? 'phone-error' : undefined}
              onChange={(event) => setField('phone', event.target.value)}
            />
          </label>

          {validation.phoneError && (
            <p id="phone-error" className="research-error" role="alert">
              {validation.phoneError}
            </p>
          )}
          {submitError && (
            <p className="research-error" role="alert">
              {submitError}
            </p>
          )}

          <p className="privacy-note">
            身份内容不会写入浏览器存储、网址、游戏日志或研究 JSON；会话创建成功后仅在本设备保存不含身份信息的会话编号。
          </p>

          <div className="research-actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={submitting}
              onClick={onBack}
            >
              返回知情同意
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={!validation.canSubmit || submitting}
            >
              {submitting ? '正在创建正式会话…' : '提交并继续'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
