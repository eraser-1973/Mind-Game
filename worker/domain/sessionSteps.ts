export const PRE_GAME_SESSION_STEPS = [
  'consent_pending',
  'demographics',
  'pre_task',
  'game_ready',
] as const

export type PreGameSessionStep = (typeof PRE_GAME_SESSION_STEPS)[number]

export function isPreGameSessionStep(value: string): value is PreGameSessionStep {
  return PRE_GAME_SESSION_STEPS.some((step) => step === value)
}

export function canSubmitConsent(step: string): boolean {
  return step === 'consent_pending' || step === 'demographics'
}

export function canSubmitDemographics(step: string): boolean {
  return step === 'demographics' || step === 'pre_task'
}

export function canSubmitPreTask(step: string): boolean {
  return step === 'pre_task'
}
