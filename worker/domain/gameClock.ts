export const FORMAL_GAME_DURATION_SEC = 15 * 60

export type GameClockSnapshot = {
  expired: boolean
  remainingSec: number
}

export function createFormalDeadline(startedAt: Date): Date {
  return new Date(startedAt.getTime() + FORMAL_GAME_DURATION_SEC * 1000)
}

export function createGameClockSnapshot(
  startedAt: string,
  deadlineAt: string,
  serverNow = new Date(),
): GameClockSnapshot {
  const startMs = Date.parse(startedAt)
  const deadlineMs = Date.parse(deadlineAt)
  const nowMs = serverNow.getTime()
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(deadlineMs) ||
    Number.isNaN(nowMs) ||
    deadlineMs <= startMs
  ) {
    throw new Error('Invalid formal game clock state.')
  }

  const remainingMs = deadlineMs - nowMs
  return {
    expired: remainingMs <= 0,
    remainingSec: Math.max(0, Math.ceil(remainingMs / 1000)),
  }
}
