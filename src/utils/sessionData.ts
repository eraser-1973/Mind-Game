import type {
  FormalPersistedSession,
  PersistedSession,
  QuickPersistedSession,
} from '../types/game'

export const SCHEMA_VERSION = 1
export const APP_VERSION = '1.1.0-session-integrity'

type FormalSessionInput = {
  participantId: string
  now?: string
  sessionId?: string
}

type QuickSessionInput = {
  now?: string
  sessionId?: string
}

export function createSessionEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createFormalPersistedSession({
  participantId,
  now = new Date().toISOString(),
  sessionId = createSessionEventId(),
}: FormalSessionInput): FormalPersistedSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    mode: 'formal',
    sessionId,
    participantId,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
    completedAt: null,
    submissionTrigger: null,
    invalidForAssessment: false,
    invalidReason: null,
    gameState: null,
    researchData: {
      participantId,
      consent: { accepted: false, acceptedAt: null },
      demographics: null,
      preTask: null,
      postTask: null,
      taskExperience: null,
      startedAt: now,
      completedAt: null,
    },
    stageSnapshots: [],
    ratingEvents: [],
    evidenceEvents: [],
    sunkCostEvents: [],
    finalDecision: null,
    clientErrors: [],
    pendingUploads: [],
  }
}

export function createQuickPersistedSession({
  now = new Date().toISOString(),
  sessionId = createSessionEventId(),
}: QuickSessionInput = {}): QuickPersistedSession {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    mode: 'quick',
    sessionId,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
    completedAt: null,
    submissionTrigger: null,
    invalidForAssessment: false,
    invalidReason: null,
    gameState: null,
    trainingEvents: [],
  }
}

export function deserializePersistedSession(
  source: string | null,
): PersistedSession | null {
  if (!source) return null

  try {
    const value: unknown = JSON.parse(source)
    if (!value || typeof value !== 'object') return null
    const session = value as Partial<PersistedSession>
    if (
      session.schemaVersion !== SCHEMA_VERSION ||
      typeof session.sessionId !== 'string' ||
      typeof session.appVersion !== 'string'
    ) {
      return null
    }

    if (session.mode === 'formal') {
      return typeof session.participantId === 'string' && Array.isArray(session.pendingUploads)
        ? (session as FormalPersistedSession)
        : null
    }

    if (session.mode === 'quick') {
      return Array.isArray(session.trainingEvents)
        ? (session as QuickPersistedSession)
        : null
    }
  } catch {
    return null
  }

  return null
}
