import { describe, expect, it } from 'vitest'
import {
  canSubmitConsent,
  canSubmitDemographics,
  canSubmitPreTask,
  isPreGameSessionStep,
} from '../worker/domain/sessionSteps'

describe('formal pre-game session step rules', () => {
  it('defines the only Stage 3 write windows without starting gameplay', () => {
    expect(canSubmitConsent('consent_pending')).toBe(true)
    expect(canSubmitConsent('demographics')).toBe(true)
    expect(canSubmitConsent('pre_task')).toBe(false)
    expect(canSubmitDemographics('demographics')).toBe(true)
    expect(canSubmitDemographics('pre_task')).toBe(true)
    expect(canSubmitDemographics('game_ready')).toBe(false)
    expect(canSubmitPreTask('pre_task')).toBe(true)
    expect(canSubmitPreTask('game_ready')).toBe(false)
    expect(isPreGameSessionStep('game_ready')).toBe(true)
    expect(isPreGameSessionStep('playing')).toBe(false)
  })
})
