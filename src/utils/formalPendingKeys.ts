type FormalGamePendingOperation =
  | 'game-start'
  | `rating:T1:${'A' | 'B' | 'C' | 'D' | 'E'}`
  | 'stage-choice:T1'

const PREFIX = 'mind-game.pending.'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function pendingFormalGameStorageKey(operation: FormalGamePendingOperation): string {
  if (operation === 'game-start') return `${PREFIX}game-start.v1`
  if (operation === 'stage-choice:T1') return `${PREFIX}stage-choice.T1.v1`
  return `${PREFIX}rating.T1.${operation.slice(-1)}.v1`
}

function defaultStorage(): Storage {
  return window.sessionStorage
}

export function getOrCreateFormalGamePendingKey(
  operation: FormalGamePendingOperation,
  storage: Pick<Storage, 'getItem' | 'setItem'> = defaultStorage(),
): string {
  const key = pendingFormalGameStorageKey(operation)
  const existing = storage.getItem(key)
  if (existing && UUID_PATTERN.test(existing)) return existing
  const created = crypto.randomUUID()
  storage.setItem(key, created)
  return created
}

export function clearFormalGamePendingKey(
  operation: FormalGamePendingOperation,
  storage: Pick<Storage, 'removeItem'> = defaultStorage(),
): void {
  storage.removeItem(pendingFormalGameStorageKey(operation))
}

export function clearAllFormalGamePendingKeys(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = defaultStorage(),
): void {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(PREFIX) && (
      key === `${PREFIX}game-start.v1` ||
      key === `${PREFIX}stage-choice.T1.v1` ||
      /^mind-game\.pending\.rating\.T1\.[A-E]\.v1$/.test(key)
    )) keys.push(key)
  }
  keys.forEach((key) => storage.removeItem(key))
}
