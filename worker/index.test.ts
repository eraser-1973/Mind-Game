import { describe, expect, it } from 'vitest'
import { createApiHandler } from './index'
import type {
  ClientErrorRow,
  EventRow,
  FormalSessionRepository,
  SessionRow,
  SnapshotRow,
} from './repository'

class MemoryRepository implements FormalSessionRepository {
  sessions = new Map<string, SessionRow>()
  events = new Map<string, EventRow>()
  snapshots = new Map<string, SnapshotRow>()
  errors = new Map<string, ClientErrorRow>()

  async createSession(row: SessionRow) { this.sessions.set(row.sessionId, row) }
  async getSession(id: string) { return this.sessions.get(id) ?? null }
  async updateSession(id: string, patch: Partial<SessionRow>) {
    const current = this.sessions.get(id)
    if (current) this.sessions.set(id, { ...current, ...patch })
  }
  async hasEvent(id: string) { return this.events.has(id) }
  async insertEvents(rows: EventRow[]) {
    rows.forEach((row) => { if (!this.events.has(row.eventId)) this.events.set(row.eventId, row) })
  }
  async insertSnapshots(rows: SnapshotRow[]) {
    rows.forEach((row) => { if (!this.snapshots.has(row.snapshotId)) this.snapshots.set(row.snapshotId, row) })
  }
  async insertClientError(row: ClientErrorRow) { this.errors.set(row.errorId, row) }
}

const jsonRequest = (url: string, method: string, body?: unknown, token?: string) =>
  new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const createSession = async (handler: ReturnType<typeof createApiHandler>) => {
  const response = await handler(jsonRequest('https://test/api/sessions', 'POST', {
    mode: 'formal',
    participantId: 'MG-TEST-001',
    schemaVersion: '1',
    appVersion: '1.1.0',
  }))
  return response.json() as Promise<{ ok: true; data: { sessionId: string; recoveryToken: string } }>
}

describe('formal session Worker API', () => {
  it('creates and resumes a formal session with a recovery token', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)

    expect(created.ok).toBe(true)
    const resumed = await handler(new Request(
      `https://test/api/sessions/${created.data.sessionId}/resume`,
      { headers: { authorization: `Bearer ${created.data.recoveryToken}` } },
    ))
    expect(resumed.status).toBe(200)
    expect(await resumed.json()).toMatchObject({ ok: true, data: { status: 'in_progress' } })
  })

  it('identifies a stale in-progress session as abandoned on resume', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)
    await repository.updateSession(created.data.sessionId, {
      lastHeartbeatAt: new Date(Date.now() - 31 * 60 * 1_000).toISOString(),
    })
    const response = await handler(new Request(
      `https://test/api/sessions/${created.data.sessionId}/resume`,
      { headers: { authorization: `Bearer ${created.data.recoveryToken}` } },
    ))
    expect(await response.json()).toMatchObject({ ok: true, data: { status: 'abandoned' } })
    expect(repository.sessions.get(created.data.sessionId)?.status).toBe('abandoned')
  })

  it('stores the same eventId only once', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)
    const event = {
      eventId: 'evt-test-001', eventType: 'verify', candidateId: 'A',
      occurredAt: new Date().toISOString(), elapsedSec: 10,
      payload: { pointsBefore: 5, pointsCost: 1, pointsAfter: 4, evidenceId: ['A-shallow-1'] },
    }
    const url = `https://test/api/sessions/${created.data.sessionId}/events`
    await handler(jsonRequest(url, 'POST', { events: [event] }, created.data.recoveryToken))
    const duplicate = await handler(jsonRequest(url, 'POST', { events: [event] }, created.data.recoveryToken))

    expect(duplicate.status).toBe(200)
    expect(repository.events.size).toBe(1)
  })

  it('rejects invalid point conservation', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)
    const response = await handler(jsonRequest(
      `https://test/api/sessions/${created.data.sessionId}/events`, 'POST', {
        events: [{
          eventId: 'evt-test-002', eventType: 'verify', occurredAt: new Date().toISOString(),
          payload: { pointsBefore: 5, pointsCost: 3, pointsAfter: 4, evidenceId: ['A-deep-1'] },
        }],
      }, created.data.recoveryToken,
    ))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'INVALID_POINTS' } })
  })

  it('rejects quick mode and identifiable payload fields', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const quick = await handler(jsonRequest('https://test/api/sessions', 'POST', {
      mode: 'quick', participantId: 'MG-TEST-002', schemaVersion: '1', appVersion: '1',
    }))
    const identifiable = await handler(jsonRequest('https://test/api/sessions', 'POST', {
      mode: 'formal', participantId: 'MG-TEST-003', schemaVersion: '1', appVersion: '1', email: 'x@example.com',
    }))
    expect(quick.status).toBe(400)
    expect(identifiable.status).toBe(400)
  })

  it('authenticates fatal client errors and invalidates the affected session', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)
    const errorId = 'error-technical-001'
    const unauthorized = await handler(jsonRequest('https://test/api/client-errors', 'POST', {
      errorId,
      sessionId: created.data.sessionId,
      errorType: 'react_boundary',
      message: 'render failed',
      occurredAt: new Date().toISOString(),
      appVersion: '1.0.0',
      fatal: true,
      affectedAssessment: true,
    }))
    expect(unauthorized.status).toBe(401)

    const accepted = await handler(jsonRequest('https://test/api/client-errors', 'POST', {
      errorId,
      sessionId: created.data.sessionId,
      errorType: 'react_boundary',
      message: 'render failed',
      occurredAt: new Date().toISOString(),
      appVersion: '1.0.0',
      fatal: true,
      affectedAssessment: true,
    }, created.data.recoveryToken))
    expect(accepted.status).toBe(200)
    expect(repository.errors.size).toBe(1)
    expect(repository.sessions.get(created.data.sessionId)).toMatchObject({
      status: 'technical_error',
      invalidForAssessment: 1,
    })
  })

  it('prevents duplicate completion and new events after completion', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)
    const url = `https://test/api/sessions/${created.data.sessionId}`
    const completion = {
      finalCandidateId: 'B', finalConfidence: 81, submissionType: 'manual',
      finalPayload: { anonymous: true },
    }
    expect((await handler(jsonRequest(`${url}/complete`, 'POST', completion, created.data.recoveryToken))).status).toBe(200)
    expect((await handler(jsonRequest(`${url}/complete`, 'POST', completion, created.data.recoveryToken))).status).toBe(409)
    const eventResponse = await handler(jsonRequest(`${url}/events`, 'POST', { events: [{
      eventId: 'evt-after-complete', eventType: 'view', occurredAt: new Date().toISOString(), payload: {},
    }] }, created.data.recoveryToken))
    expect(eventResponse.status).toBe(409)
  })

  it('rejects snapshot confidence outside 0 to 100', async () => {
    const repository = new MemoryRepository()
    const handler = createApiHandler(repository)
    const created = await createSession(handler)
    const response = await handler(jsonRequest(
      `https://test/api/sessions/${created.data.sessionId}/snapshots`, 'POST', {
        snapshots: [{ snapshotId: 'snap-001', stage: 'T1', preferredCandidateId: 'B', confidence: 101, submittedAt: new Date().toISOString() }],
      }, created.data.recoveryToken,
    ))
    expect(response.status).toBe(400)
  })
})
