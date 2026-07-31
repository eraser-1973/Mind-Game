import type { FormalSessionContext } from '../types/game'
import { isFormalSessionContext } from './formalSessionContext'

export const FORMAL_SESSION_STORAGE_KEY = 'mind-game.formal-session.v1'
export const PENDING_CREATION_KEY_STORAGE_KEY =
  'mind-game.formal-session.creation-key.v1'

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
    return isFormalSessionContext(parsed) ? parsed : null
  } catch {
    return null
  }
}
