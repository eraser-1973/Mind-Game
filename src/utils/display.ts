export const formatDisplayedValue = (
  value: number | null | undefined,
): string => (value == null ? '0' : String(value))

export const formatDisplayedCopy = (value: string): string =>
  value.replaceAll('未作答', '无记录')
