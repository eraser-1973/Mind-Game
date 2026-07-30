import type { GameMode } from '../types/game'

export type ModePolicy = {
  backendPersistence: boolean
  localStorageKey: string
  indexedDbNamespace: string
  feedbackPolicy: 'neutral' | 'training'
  evidenceStyle: 'neutral' | 'directional'
  nikoPolicy: 'hidden' | 'evaluative'
  hrMessagePolicy: 'pressure_only' | 'training'
  debugControls: boolean
  exportPolicy: 'hidden' | 'local'
  reportPolicy: 'research' | 'training'
}

export const modePolicies: Record<GameMode, ModePolicy> = {
  formal: {
    backendPersistence: true,
    localStorageKey: 'mind-game:formal:recovery:v1',
    indexedDbNamespace: 'mind-game-formal-v1',
    feedbackPolicy: 'neutral', evidenceStyle: 'neutral', nikoPolicy: 'hidden',
    hrMessagePolicy: 'pressure_only', debugControls: false, exportPolicy: 'hidden', reportPolicy: 'research',
  },
  quick: {
    backendPersistence: false,
    localStorageKey: 'mind-game:quick:local:v1',
    indexedDbNamespace: 'mind-game-quick-v1',
    feedbackPolicy: 'training', evidenceStyle: 'directional', nikoPolicy: 'evaluative',
    hrMessagePolicy: 'training', debugControls: true, exportPolicy: 'local', reportPolicy: 'training',
  },
}
