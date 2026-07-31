import { describe, expect, it } from 'vitest'
import type { FormalSessionContext } from '../types/game'
import {
  clearPendingCreationKey,
  FORMAL_SESSION_STORAGE_KEY,
  getOrCreatePendingCreationKey,
  loadFormalSessionContext,
  PENDING_CREATION_KEY_STORAGE_KEY,
  saveFormalSessionContext,
  type StorageLike,
} from './formalSessionStorage'

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const context: FormalSessionContext = {
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  configSetId: 'config-2026-07-v1',
  versions: {
    task: 'task-1.0.0',
    material: 'material-1.0.0',
    pointRule: 'points-5-v1',
    scoring: 'RDI-2.0-prepilot',
    benchmark: 'benchmark-1.0.0',
    norm: null,
  },
  candidateDisplayOrder: ['B', 'E', 'A', 'D', 'C'],
  initialOpenedCandidate: 'B',
  createdAt: '2026-07-31T00:00:00.000Z',
}

describe('formal session storage', () => {
  it('creates one pending UUID and reuses it until explicitly cleared', () => {
    const storage = new MemoryStorage()
    const values = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]
    const generator = () => values.shift()!

    expect(getOrCreatePendingCreationKey(storage, generator)).toBe(
      '33333333-3333-4333-8333-333333333333',
    )
    expect(getOrCreatePendingCreationKey(storage, generator)).toBe(
      '33333333-3333-4333-8333-333333333333',
    )
    clearPendingCreationKey(storage)
    expect(getOrCreatePendingCreationKey(storage, generator)).toBe(
      '44444444-4444-4444-8444-444444444444',
    )
  })

  it('persists and validates only the safe formal session context', () => {
    const storage = new MemoryStorage()
    saveFormalSessionContext(context, storage)

    expect(loadFormalSessionContext(storage)).toEqual(context)
    const serialized = storage.getItem(FORMAL_SESSION_STORAGE_KEY) ?? ''
    expect(serialized).not.toMatch(
      /fullName|studentId|phone|identity|token|cookie|tokenHash/i,
    )
    expect(storage.getItem(PENDING_CREATION_KEY_STORAGE_KEY)).toBeNull()
  })

  it('ignores corrupt JSON and invalid candidate orders safely', () => {
    const storage = new MemoryStorage()
    storage.setItem(FORMAL_SESSION_STORAGE_KEY, '{broken')
    expect(loadFormalSessionContext(storage)).toBeNull()

    storage.setItem(
      FORMAL_SESSION_STORAGE_KEY,
      JSON.stringify({
        ...context,
        candidateDisplayOrder: ['A', 'A', 'B', 'C', 'D'],
      }),
    )
    expect(loadFormalSessionContext(storage)).toBeNull()
  })

  it('replaces an invalid pending key instead of reusing it', () => {
    const storage = new MemoryStorage()
    storage.setItem(PENDING_CREATION_KEY_STORAGE_KEY, 'not-a-uuid')

    expect(
      getOrCreatePendingCreationKey(
        storage,
        () => '55555555-5555-4555-8555-555555555555',
      ),
    ).toBe('55555555-5555-4555-8555-555555555555')
  })
})
