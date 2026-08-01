import { describe, expect, it } from 'vitest'
import { createGameClockSnapshot, FORMAL_GAME_DURATION_SEC } from '../worker/domain/gameClock'

describe('formal game clock', () => {
  it('uses a fixed 900 second server deadline', () => {
    const startedAt = '2026-08-01T00:00:00.000Z'
    const deadlineAt = '2026-08-01T00:15:00.000Z'
    const snapshot = createGameClockSnapshot(
      startedAt,
      deadlineAt,
      new Date('2026-08-01T00:02:45.100Z'),
    )
    expect(FORMAL_GAME_DURATION_SEC).toBe(900)
    expect(snapshot).toEqual({ expired: false, remainingSec: 735 })
  })

  it.each([
    ['2026-08-01T00:14:59.001Z', false, 1],
    ['2026-08-01T00:15:00.000Z', true, 0],
    ['2026-08-01T01:00:00.000Z', true, 0],
  ])('clamps remaining time and expires at the deadline', (now, expired, remainingSec) => {
    expect(createGameClockSnapshot(
      '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:15:00.000Z',
      new Date(now),
    )).toEqual({ expired, remainingSec })
  })

  it('rejects invalid or inconsistent stored timestamps', () => {
    expect(() => createGameClockSnapshot('bad', 'also-bad', new Date())).toThrow()
    expect(() => createGameClockSnapshot(
      '2026-08-01T00:15:00.000Z',
      '2026-08-01T00:00:00.000Z',
      new Date(),
    )).toThrow()
  })
})
