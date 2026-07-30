import { describe, expect, it } from 'vitest'
import { MemoryFormalSessionStore } from './formalSessionStore'
import { FormalOutbox } from './formalOutbox'
import { modePolicies } from '../config/modePolicies'

describe('formal offline outbox', () => {
  it('deduplicates eventIds and removes only successfully uploaded items', async () => {
    const store = new MemoryFormalSessionStore()
    const uploaded: string[] = []
    const outbox = new FormalOutbox(store, async (item) => {
      uploaded.push(item.eventId)
    })
    const item = {
      eventId: 'evt-offline-001', sessionId: 'sess-test-001',
      kind: 'events' as const, payload: { events: [] }, queuedAt: '2026-07-30T00:00:00.000Z', attempts: 0,
    }
    await outbox.enqueue(item)
    await outbox.enqueue(item)
    expect(await store.listOutbox()).toHaveLength(1)
    await outbox.flush()
    expect(uploaded).toEqual(['evt-offline-001'])
    expect(await store.listOutbox()).toEqual([])
  })

  it('keeps failed uploads and increments attempts for later retry', async () => {
    const store = new MemoryFormalSessionStore()
    const outbox = new FormalOutbox(store, async () => { throw new Error('offline') })
    await outbox.enqueue({
      eventId: 'evt-offline-002', sessionId: 'sess-test-001', kind: 'events',
      payload: {}, queuedAt: '2026-07-30T00:00:00.000Z', attempts: 0,
    })
    await outbox.flush()
    const [retained] = await store.listOutbox()
    expect(retained.attempts).toBe(1)
    expect(retained.nextAttemptAt).toBeTruthy()
  })

  it('stops after a failed item so completion cannot overtake behavior events', async () => {
    const store = new MemoryFormalSessionStore()
    const uploaded: string[] = []
    const outbox = new FormalOutbox(store, async (item) => {
      uploaded.push(item.eventId)
      if (item.kind === 'events') throw new Error('offline')
    })
    await outbox.enqueue({
      eventId: 'evt-before-complete', sessionId: 'sess-test-001', kind: 'events',
      payload: {}, queuedAt: '2026-07-30T00:00:00.000Z', attempts: 0,
    })
    await outbox.enqueue({
      eventId: 'complete-after-events', sessionId: 'sess-test-001', kind: 'complete',
      payload: {}, queuedAt: '2026-07-30T00:00:01.000Z', attempts: 0,
    })

    await outbox.flush()

    expect(uploaded).toEqual(['evt-before-complete'])
    expect(await store.listOutbox()).toHaveLength(2)
  })

  it('uses separate formal and quick policies and forbids quick backend persistence', () => {
    expect(modePolicies.formal.backendPersistence).toBe(true)
    expect(modePolicies.quick.backendPersistence).toBe(false)
    expect(modePolicies.formal.localStorageKey).not.toBe(modePolicies.quick.localStorageKey)
    expect(modePolicies.formal.indexedDbNamespace).not.toBe(modePolicies.quick.indexedDbNamespace)
  })
})
