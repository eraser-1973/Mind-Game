import type { PressureStage } from '../types/game'

export const FORMAL_DURATION_SEC = 15 * 60
export const QUICK_DURATION_SEC = 3 * 60

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
  return `${minutes.toString().padStart(2, '0')}:${remainder
    .toString()
    .padStart(2, '0')}`
}

export function getPressureStage(
  elapsedSec: number,
  durationSec: number,
): PressureStage {
  const progress = Math.max(0, Math.min(1, elapsedSec / durationSec))
  if (progress <= 1 / 3) return 'green'
  if (progress <= 2 / 3) return 'orange'
  return 'red'
}

export function getSunkCostThreshold(durationSec: number): number {
  return Math.floor(durationSec / 3)
}

export function isFinalWarning(
  timeLeftSec: number,
  durationSec: number,
): boolean {
  const warningWindow = Math.min(180, Math.floor(durationSec * 0.2))
  return timeLeftSec <= warningWindow
}
