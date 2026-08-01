type FormalGamePendingOperation =
  | 'game-start'
  | `rating:${'T1' | 'T2' | 'T3'}:${'A' | 'B' | 'C' | 'D' | 'E'}`
  | `stage-choice:${'T1' | 'T2' | 'T3'}`
  | `evidence:${'shallow' | 'deep'}:${'A' | 'B' | 'C' | 'D' | 'E'}`
  | 'sunk-cost-show'
  | 'sunk-cost-choice'
  | 'final-decision'
  | 'timeout-final-decision'

const PREFIX = 'mind-game.pending.'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function pendingFormalGameStorageKey(operation: FormalGamePendingOperation): string {
  if (operation === 'game-start') return `${PREFIX}game-start.v1`
  if (operation === 'sunk-cost-show') return `${PREFIX}sunk-cost-show.v1`
  if (operation === 'sunk-cost-choice') return `${PREFIX}sunk-cost-choice.v1`
  if (operation === 'final-decision') return `${PREFIX}final-decision.v1`
  if (operation === 'timeout-final-decision') return `${PREFIX}timeout-final-decision.v1`
  const [kind, stageOrLevel, candidateId] = operation.split(':')
  if (kind === 'stage-choice') return `${PREFIX}stage-choice.${stageOrLevel}.v1`
  return `${PREFIX}${kind}.${stageOrLevel}.${candidateId}.v1`
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
      /^mind-game\.pending\.(sunk-cost-show|sunk-cost-choice|final-decision|timeout-final-decision)\.v1$/.test(key) ||
      /^mind-game\.pending\.stage-choice\.T[123]\.v1$/.test(key) ||
      /^mind-game\.pending\.rating\.T[123]\.[A-E]\.v1$/.test(key) ||
      /^mind-game\.pending\.evidence\.(shallow|deep)\.[A-E]\.v1$/.test(key)
    )) keys.push(key)
  }
  keys.forEach((key) => storage.removeItem(key))
}
