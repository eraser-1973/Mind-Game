import { describe, expect, it } from 'vitest'
import {
  formatTime,
  getPressureStage,
  getSunkCostThreshold,
  isFinalWarning,
} from './time'

describe('time pressure helpers', () => {
  it('formats seconds as minutes and seconds', () => {
    expect(formatTime(181)).toBe('03:01')
  })

  it('splits the session into green, orange and red thirds', () => {
    expect(getPressureStage(0, 900)).toBe('green')
    expect(getPressureStage(301, 900)).toBe('orange')
    expect(getPressureStage(601, 900)).toBe('red')
  })

  it('uses the last five minutes formally and last minute in quick mode', () => {
    expect(getSunkCostThreshold(900)).toBe(300)
    expect(getSunkCostThreshold(180)).toBe(60)
  })

  it('flashes in the last three formal minutes and proportional quick warning', () => {
    expect(isFinalWarning(180, 900)).toBe(true)
    expect(isFinalWarning(181, 900)).toBe(false)
    expect(isFinalWarning(36, 180)).toBe(true)
  })
})
