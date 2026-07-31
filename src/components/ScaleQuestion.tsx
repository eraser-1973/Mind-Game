type Props = {
  id: string
  label: string
  value: number | null
  min: number
  max: number
  leftLabel: string
  rightLabel: string
  onChange: (value: number) => void
  touched?: boolean
  invalid?: boolean
  autoFocus?: boolean
}

export function ScaleQuestion({
  id,
  label,
  value,
  min,
  max,
  leftLabel,
  rightLabel,
  onChange,
  touched = value !== null,
  invalid = false,
  autoFocus = false,
}: Props) {
  return (
    <label className="scale-question" htmlFor={id}>
      <div className="scale-question__head">
        <span>{label}</span>
        <strong>{value ?? 0}</strong>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value ?? 0}
        data-touched={touched ? 'true' : 'false'}
        aria-invalid={invalid}
        autoFocus={autoFocus}
        onPointerDown={() => {
          if (!touched) onChange(value ?? min)
        }}
        onKeyDown={() => {
          if (!touched) onChange(value ?? min)
        }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="scale-question__labels">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </label>
  )
}
