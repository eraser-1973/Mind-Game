import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllFormalGamePendingKeys,
  clearFormalGamePendingKey,
  getOrCreateFormalGamePendingKey,
  pendingFormalGameStorageKey,
} from './formalPendingKeys'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

let storage: MemoryStorage

beforeEach(() => { storage = new MemoryStorage() })

describe('formal game pending UUID keys', () => {
  it.each([
    ['game-start', 'mind-game.pending.game-start.v1'],
    ['rating:T1:A', 'mind-game.pending.rating.T1.A.v1'],
    ['stage-choice:T1', 'mind-game.pending.stage-choice.T1.v1'],
  ] as const)('uses isolated key %s', (operation, expected) => {
    expect(pendingFormalGameStorageKey(operation)).toBe(expected)
  })

  it('reuses one UUID until success and stores no answer content', () => {
    const first = getOrCreateFormalGamePendingKey('rating:T1:B', storage)
    const second = getOrCreateFormalGamePendingKey('rating:T1:B', storage)
    expect(second).toBe(first)
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect([...storage.values.values()]).toEqual([first])
    clearFormalGamePendingKey('rating:T1:B', storage)
    expect(storage.length).toBe(0)
  })

  it('clears only formal game pending keys', () => {
    storage.setItem('unrelated', 'keep')
    getOrCreateFormalGamePendingKey('game-start', storage)
    getOrCreateFormalGamePendingKey('stage-choice:T1', storage)
    clearAllFormalGamePendingKeys(storage)
    expect(storage.getItem('unrelated')).toBe('keep')
    expect(storage.length).toBe(1)
  })
})
