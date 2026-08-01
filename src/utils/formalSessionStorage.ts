import type { FormalSessionContext } from '../types/game'
import { isFormalSessionContext } from './formalSessionContext'

export const FORMAL_SESSION_STORAGE_KEY = 'mind-game.formal-session.v1'
export const PENDING_CREATION_KEY_STORAGE_KEY =
  'mind-game.pending.session-create.v1'
export const PENDING_CONSENT_KEY_STORAGE_KEY =
  'mind-game.pending.consent.v1'
export const PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY =
  'mind-game.pending.demographics.v1'
export const PENDING_PRE_TASK_KEY_STORAGE_KEY =
  'mind-game.pending.pre-task.v1'
export const PENDING_POST_TASK_KEY_STORAGE_KEY =
  'mind-game.pending.post-task.v1'
export const PENDING_TASK_EXPERIENCE_KEY_STORAGE_KEY =
  'mind-game.pending.task-experience.v1'
export const PENDING_COMPLETION_KEY_STORAGE_KEY =
  'mind-game.pending.session-end.v1'

export type FormalPendingOperation =
  | 'consent'
  | 'demographics'
  | 'preTask'
  | 'postTask'
  | 'taskExperience'
  | 'completion'

const operationKeys: Record<FormalPendingOperation, string> = {
  consent: PENDING_CONSENT_KEY_STORAGE_KEY,
  demographics: PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY,
  preTask: PENDING_PRE_TASK_KEY_STORAGE_KEY,
  postTask: PENDING_POST_TASK_KEY_STORAGE_KEY,
  taskExperience: PENDING_TASK_EXPERIENCE_KEY_STORAGE_KEY,
  completion: PENDING_COMPLETION_KEY_STORAGE_KEY,
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function getOrCreatePendingCreationKey(
  storage: StorageLike = window.sessionStorage,
  createUuid: () => string = () => crypto.randomUUID(),
): string {
  const existing = storage.getItem(PENDING_CREATION_KEY_STORAGE_KEY)
  if (existing && UUID_PATTERN.test(existing)) return existing

  const created = createUuid()
  if (!UUID_PATTERN.test(created)) {
    throw new Error('Unable to create a valid session key.')
  }
  storage.setItem(PENDING_CREATION_KEY_STORAGE_KEY, created)
  return created
}

export function clearPendingCreationKey(
  storage: StorageLike = window.sessionStorage,
): void {
  storage.removeItem(PENDING_CREATION_KEY_STORAGE_KEY)
}

export function getOrCreatePendingOperationKey(
  operation: FormalPendingOperation,
  storage: StorageLike = window.sessionStorage,
  createUuid: () => string = () => crypto.randomUUID(),
): string {
  const key = operationKeys[operation]
  const existing = storage.getItem(key)
  if (existing && UUID_PATTERN.test(existing)) return existing
  const created = createUuid()
  if (!UUID_PATTERN.test(created)) {
    throw new Error('Unable to create a valid operation key.')
  }
  storage.setItem(key, created)
  return created
}

export function clearPendingOperationKey(
  operation: FormalPendingOperation,
  storage: StorageLike = window.sessionStorage,
): void {
  storage.removeItem(operationKeys[operation])
}

export function saveFormalSessionContext(
  context: FormalSessionContext,
  storage: StorageLike = window.localStorage,
): void {
  if (!isFormalSessionContext(context)) {
    throw new Error('Invalid formal session context.')
  }
  storage.setItem(FORMAL_SESSION_STORAGE_KEY, JSON.stringify(context))
}

export function loadFormalSessionContext(
  storage: StorageLike = window.localStorage,
): FormalSessionContext | null {
  const serialized = storage.getItem(FORMAL_SESSION_STORAGE_KEY)
  if (!serialized) return null

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (isFormalSessionContext(parsed)) return parsed
    storage.removeItem(FORMAL_SESSION_STORAGE_KEY)
    return null
  } catch {
    storage.removeItem(FORMAL_SESSION_STORAGE_KEY)
    return null
  }
}

export function removeFormalSessionContext(
  storage: StorageLike = window.localStorage,
): void {
  storage.removeItem(FORMAL_SESSION_STORAGE_KEY)
}
