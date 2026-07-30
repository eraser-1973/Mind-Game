import { describe, expect, it, vi } from 'vitest'
import {
  APP_VERSION,
  SCHEMA_VERSION,
  createFormalPersistedSession,
  createQuickPersistedSession,
  createSessionEventId,
  deserializePersistedSession,
} from './sessionData'

describe('persisted session data', () => {
  it('creates a versioned formal session with an isolated upload queue', () => {
    const session = createFormalPersistedSession({
      participantId: 'MG-TEST-001',
      now: '2026-07-30T00:00:00.000Z',
      sessionId: 'session-001',
    })

    expect(session).toMatchObject({
      mode: 'formal',
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      status: 'in_progress',
      participantId: 'MG-TEST-001',
      sessionId: 'session-001',
      pendingUploads: [],
      stageSnapshots: [],
      ratingEvents: [],
      evidenceEvents: [],
      clientErrors: [],
    })
    expect(session.gameState).toBeNull()
  })

  it('creates a quick session that cannot carry formal research upload data', () => {
    const session = createQuickPersistedSession({
      now: '2026-07-30T00:00:00.000Z',
      sessionId: 'quick-001',
    })

    expect(session.mode).toBe('quick')
    expect('pendingUploads' in session).toBe(false)
    expect('participantId' in session).toBe(false)
  })

  it('generates distinct event ids and keeps discriminated sessions serializable', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')

    expect(createSessionEventId()).toBe('00000000-0000-4000-8000-000000000001')
    expect(createSessionEventId()).toBe('00000000-0000-4000-8000-000000000002')

    const source = createFormalPersistedSession({
      participantId: 'MG-TEST-002',
      now: '2026-07-30T00:00:00.000Z',
      sessionId: 'session-002',
    })
    const restored = deserializePersistedSession(JSON.stringify(source))

    expect(restored).toEqual(source)
    expect(restored?.mode).toBe('formal')
    vi.restoreAllMocks()
  })

  it('rejects unversioned or malformed persisted data instead of silently mixing modes', () => {
    expect(deserializePersistedSession('{"mode":"formal"}')).toBeNull()
    expect(deserializePersistedSession('{"mode":"unknown"}')).toBeNull()
  })
})
