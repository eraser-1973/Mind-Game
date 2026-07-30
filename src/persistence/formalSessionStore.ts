import type { GameState, ResearchData, ResearchStep } from '../types/game'
import { modePolicies } from '../config/modePolicies'

export type FormalRecoveryPointer = { sessionId: string; recoveryToken: string }
export type FormalSessionSnapshot = {
  sessionId: string
  recoveryToken: string
  participantId: string
  researchStep: ResearchStep | null
  researchData: ResearchData
  gameState: GameState | null
  savedAt: string
  technicalPauseStartedAt: string | null
  accumulatedTechnicalPauseMs: number
}
export type FormalOutboxItem = {
  eventId: string
  sessionId: string
  kind: 'events' | 'snapshots' | 'heartbeat' | 'complete' | 'abandon' | 'client_error'
  payload: unknown
  queuedAt: string
  attempts: number
  nextAttemptAt?: string
}

export interface FormalSessionStore {
  saveSnapshot(snapshot: FormalSessionSnapshot): Promise<void>
  loadSnapshot(sessionId: string): Promise<FormalSessionSnapshot | null>
  deleteSnapshot(sessionId: string): Promise<void>
  putOutbox(item: FormalOutboxItem): Promise<void>
  listOutbox(sessionId?: string): Promise<FormalOutboxItem[]>
  deleteOutbox(eventId: string): Promise<void>
}

export class MemoryFormalSessionStore implements FormalSessionStore {
  snapshots = new Map<string, FormalSessionSnapshot>()
  outbox = new Map<string, FormalOutboxItem>()
  async saveSnapshot(value: FormalSessionSnapshot) { this.snapshots.set(value.sessionId, structuredClone(value)) }
  async loadSnapshot(id: string) { return structuredClone(this.snapshots.get(id) ?? null) }
  async deleteSnapshot(id: string) { this.snapshots.delete(id) }
  async putOutbox(value: FormalOutboxItem) { this.outbox.set(value.eventId, structuredClone(value)) }
  async listOutbox(sessionId?: string) { return [...this.outbox.values()].filter((item) => !sessionId || item.sessionId === sessionId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)).map((item) => structuredClone(item)) }
  async deleteOutbox(id: string) { this.outbox.delete(id) }
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
})

export class IndexedDbFormalSessionStore implements FormalSessionStore {
  private database: Promise<IDBDatabase>
  constructor(name = modePolicies.formal.indexedDbNamespace) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'sessionId' })
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'eventId' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Unable to open formal session database'))
    })
  }
  private async store(name: 'snapshots' | 'outbox', mode: IDBTransactionMode) {
    return (await this.database).transaction(name, mode).objectStore(name)
  }
  async saveSnapshot(value: FormalSessionSnapshot) { await requestResult((await this.store('snapshots', 'readwrite')).put(value)) }
  async loadSnapshot(id: string) { return (await requestResult((await this.store('snapshots', 'readonly')).get(id)) as FormalSessionSnapshot | undefined) ?? null }
  async deleteSnapshot(id: string) { await requestResult((await this.store('snapshots', 'readwrite')).delete(id)) }
  async putOutbox(value: FormalOutboxItem) { await requestResult((await this.store('outbox', 'readwrite')).put(value)) }
  async listOutbox(sessionId?: string) {
    const values = await requestResult((await this.store('outbox', 'readonly')).getAll()) as FormalOutboxItem[]
    return values.filter((item) => !sessionId || item.sessionId === sessionId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
  }
  async deleteOutbox(id: string) { await requestResult((await this.store('outbox', 'readwrite')).delete(id)) }
}

export const saveRecoveryPointer = (value: FormalRecoveryPointer) => localStorage.setItem(modePolicies.formal.localStorageKey, JSON.stringify(value))
export const loadRecoveryPointer = (): FormalRecoveryPointer | null => {
  try { return JSON.parse(localStorage.getItem(modePolicies.formal.localStorageKey) ?? 'null') as FormalRecoveryPointer | null } catch { return null }
}
export const clearRecoveryPointer = () => localStorage.removeItem(modePolicies.formal.localStorageKey)
