import { describe, expect, it } from 'vitest'
import type { FormalSessionContext } from '../types/game'
import {
  clearPendingCreationKey,
  clearPendingOperationKey,
  FORMAL_SESSION_STORAGE_KEY,
  getOrCreatePendingCreationKey,
  getOrCreatePendingOperationKey,
  loadFormalSessionContext,
  PENDING_CONSENT_KEY_STORAGE_KEY,
  PENDING_CREATION_KEY_STORAGE_KEY,
  PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY,
  PENDING_PRE_TASK_KEY_STORAGE_KEY,
  removeFormalSessionContext,
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
    sunkCostRule: 'sunk-1.0.0',
    scoring: 'RDI-2.0-prepilot',
    benchmark: 'benchmark-1.0.0',
    norm: null,
  },
  candidateDisplayOrder: ['B', 'E', 'A', 'D', 'C'],
  initialOpenedCandidate: 'B',
  currentStep: 'consent_pending',
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

  it('uses independent payload-free operation keys and clears only the completed operation', () => {
    const storage = new MemoryStorage()
    const generated = [
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    ]
    const createUuid = () => generated.shift()!

    expect(getOrCreatePendingOperationKey('consent', storage, createUuid)).toBe(
      '66666666-6666-4666-8666-666666666666',
    )
    expect(getOrCreatePendingOperationKey('demographics', storage, createUuid)).toBe(
      '77777777-7777-4777-8777-777777777777',
    )
    expect(getOrCreatePendingOperationKey('preTask', storage, createUuid)).toBe(
      '88888888-8888-4888-8888-888888888888',
    )
    clearPendingOperationKey('consent', storage)
    expect(storage.getItem(PENDING_CONSENT_KEY_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(PENDING_DEMOGRAPHICS_KEY_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(PENDING_PRE_TASK_KEY_STORAGE_KEY)).not.toBeNull()
    expect(JSON.stringify(storage)).not.toContain('ageRange')
  })

  it('removes corrupt safe context and supports explicit session removal', () => {
    const storage = new MemoryStorage()
    storage.setItem(FORMAL_SESSION_STORAGE_KEY, '{broken')
    expect(loadFormalSessionContext(storage)).toBeNull()
    expect(storage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()

    saveFormalSessionContext(context, storage)
    removeFormalSessionContext(storage)
    expect(storage.getItem(FORMAL_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('uses the required session-create key namespace', () => {
    expect(PENDING_CREATION_KEY_STORAGE_KEY).toBe('mind-game.pending.session-create.v1')
  })
})
