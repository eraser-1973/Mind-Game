import type { ClientError } from '../types/game'
import { formalSessionApi } from '../api/formalSessionApi'
import {
  IndexedDbFormalSessionStore,
  loadRecoveryPointer,
  type FormalOutboxItem,
} from '../persistence/formalSessionStore'
import { APP_VERSION, createSessionEventId } from './sessionData'

type BuildClientErrorOptions = {
  sessionId?: string | null
  errorType: ClientError['errorType']
  fatal?: boolean
  affectedAssessment?: boolean
  route?: string
  occurredAt?: string
}

export const buildClientError = (
  cause: unknown,
  options: BuildClientErrorOptions,
): ClientError => {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  const fatal = options.fatal ?? false
  return {
    errorId: createSessionEventId(),
    sessionId: options.sessionId ?? null,
    errorType: options.errorType,
    message: error.message.slice(0, 2_000),
    stack: error.stack?.slice(0, 8_000) ?? null,
    route: options.route ?? window.location.pathname,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    appVersion: APP_VERSION,
    fatal,
    affectedAssessment: options.affectedAssessment ?? fatal,
  }
}

export const dispatchTechnicalError = (error: ClientError) => {
  window.dispatchEvent(
    new CustomEvent<ClientError>('mind-game:technical-error', { detail: error }),
  )
}

export const captureClientError = async (
  cause: unknown,
  options: Omit<BuildClientErrorOptions, 'sessionId'>,
): Promise<ClientError> => {
  const pointer = loadRecoveryPointer()
  const error = buildClientError(cause, {
    ...options,
    sessionId: pointer?.sessionId ?? null,
  })
  dispatchTechnicalError(error)
  if (!pointer) return error

  const item: FormalOutboxItem = {
    eventId: error.errorId,
    sessionId: pointer.sessionId,
    kind: 'client_error',
    payload: error,
    queuedAt: error.occurredAt,
    attempts: 0,
  }

  try {
    const store = new IndexedDbFormalSessionStore()
    await store.putOutbox(item)
    const snapshot = await store.loadSnapshot(pointer.sessionId)
    if (snapshot?.gameState && error.affectedAssessment) {
      snapshot.gameState.invalidForAssessment = true
      snapshot.gameState.invalidReason = error.message
      snapshot.gameState.technicalPauseStartedAt ??= error.occurredAt
      snapshot.technicalPauseStartedAt ??= error.occurredAt
      snapshot.savedAt = new Date().toISOString()
      await store.saveSnapshot(snapshot)
    }
    try {
      await formalSessionApi.upload(item, pointer.recoveryToken)
      await store.deleteOutbox(item.eventId)
    } catch {
      // The durable outbox retains the error until connectivity returns.
    }
  } catch {
    try {
      await formalSessionApi.upload(item, pointer.recoveryToken)
    } catch {
      // A storage and network double failure cannot be persisted safely.
    }
  }
  return error
}
