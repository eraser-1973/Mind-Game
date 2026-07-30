type Props = {
  id: string
  label: string
  value: number | null
  min: number
  max: number
  leftLabel: string
  rightLabel: string
  invalid?: boolean
  onChange: (value: number) => void
}

export function ScaleQuestion({
  id,
  label,
  value,
  min,
  max,
  leftLabel,
  rightLabel,
  invalid = false,
  onChange,
}: Props) {
  return (
    <label className="scale-question" htmlFor={id}>
      <div className="scale-question__head">
        <span>{label}</span>
        <strong>{value ?? '未作答'}</strong>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value ?? min}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="scale-question__labels">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </label>
  )
}
