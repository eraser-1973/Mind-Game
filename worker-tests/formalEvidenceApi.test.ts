import type { Miniflare } from 'miniflare'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkerRuntime } from './runtime'

type FormalSession = { sessionId: string; participantId: string; cookie: string }

let runtime: Miniflare
let db: D1Database

beforeEach(async () => {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  db = created.db
})

afterEach(async () => runtime.dispose())

async function post(path: string, body: unknown, cookie = '', key = crypto.randomUUID()) {
  return runtime.dispatchFetch(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  })
}

async function createSession(): Promise<FormalSession> {
  const response = await post('/api/sessions', {
    mode: 'formal',
    identity: { fullName: 'Evidence API Test' },
    clientVersion: 'stage-5-test',
  })
  const payload = await response.json() as { data: { sessionId: string; participantId: string } }
  return {
    ...payload.data,
    cookie: (response.headers.get('Set-Cookie') ?? '').split(';')[0],
  }
}

async function seedT1Complete(options?: { points?: number; deadlineAt?: string }) {
  const session = await createSession()
  const now = new Date().toISOString()
  const deadlineAt = options?.deadlineAt ?? new Date(Date.now() + 900_000).toISOString()
  const startedAt = new Date(Date.parse(deadlineAt) - 900_000).toISOString()
  const points = options?.points ?? 5
  const ratingStatements = ['A', 'B', 'C', 'D', 'E'].map((candidateId, index) =>
    db.prepare(`INSERT INTO stage_ratings (
      rating_id, event_id, session_id, candidate_id, stage, rating_value,
      evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, ?, 'T1', 50, json('[]'), ?, ?, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, candidateId, now, now, index + 2))
  await db.batch([
    db.prepare(`UPDATE sessions SET current_step = 'playing', started_at = ?, deadline_at = ?
      WHERE session_id = ?`).bind(startedAt, deadlineAt, session.sessionId),
    db.prepare(`INSERT INTO game_runs (
      session_id, start_event_id, current_stage, duration_sec,
      points_total, points_remaining, last_sequence_no,
      started_at, deadline_at, t1_completed_at, updated_at
    ) VALUES (?, ?, 'T1_COMPLETE', 900, 5, ?, 7, ?, ?, ?, ?)`)
      .bind(session.sessionId, crypto.randomUUID(), points, startedAt, deadlineAt, now, now),
    ...ratingStatements,
    db.prepare(`INSERT INTO stage_choices (
      choice_id, event_id, session_id, stage, candidate_id, confidence,
      submit_mode, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'T1', 'B', 70, 'active', ?, ?, 7)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, now, now),
  ])
  return session
}

function unlockBody(sessionId: string, candidateId = 'A', level = 'shallow') {
  return {
    sessionId,
    candidateId,
    level,
    clientAt: new Date().toISOString(),
    clientSequence: 8,
  }
}

async function unlock(
  session: FormalSession,
  candidateId = 'A',
  level = 'shallow',
  key = crypto.randomUUID(),
  extra: Record<string, unknown> = {},
) {
  return post('/api/evidence/unlock', {
    ...unlockBody(session.sessionId, candidateId, level),
    ...extra,
  }, session.cookie, key)
}

describe('formal shallow evidence unlock', () => {
  it('atomically unlocks ordered server evidence, deducts one point, and advances to T2', async () => {
    const session = await seedT1Complete()
    const response = await unlock(session)
    const payload = await response.json() as { data: Record<string, unknown> }

    expect(response.status).toBe(201)
    expect(payload.data).toMatchObject({
      created: true,
      alreadyUnlocked: false,
      sessionId: session.sessionId,
      candidateId: 'A',
      level: 'shallow',
      ratingStage: 'T2',
      sequenceNo: 8,
      points: { before: 5, cost: 1, after: 4, total: 5 },
      currentStage: 'T2',
      stageStatus: 'T2_ACTIVE',
      evidence: [
        { id: 'A-t2-1', order: 1, polarity: 'negative' },
        { id: 'A-t2-2', order: 2, polarity: 'negative' },
      ],
    })
    const serialized = JSON.stringify(payload)
    for (const privateKey of [
      'isKeyRisk', 'containsKeyRisk', 'trueAbility', 'trueFit', 'isToxic',
      'riskFlags', 'baselineFitScore', 'identity', 'tokenHash',
    ]) expect(serialized).not.toContain(privateKey)

    const state = await db.prepare(`SELECT g.current_stage, g.points_remaining,
      g.last_sequence_no, e.points_before, e.points_cost, e.points_after,
      l.points_delta, l.sequence_no AS ledger_sequence,
      ge.server_sequence AS event_sequence
      FROM game_runs g
      JOIN evidence_events e ON e.session_id = g.session_id
      JOIN point_ledger l ON l.event_id = e.event_id
      JOIN game_events ge ON ge.event_id = e.event_id
      WHERE g.session_id = ?`).bind(session.sessionId).first<Record<string, unknown>>()
    expect(state).toMatchObject({
      current_stage: 'T2', points_remaining: 4, last_sequence_no: 8,
      points_before: 5, points_cost: 1, points_after: 4,
      points_delta: -1, ledger_sequence: 8, event_sequence: 8,
    })
    const itemCount = await db.prepare(
      'SELECT COUNT(*) AS count FROM evidence_event_items WHERE event_id = (SELECT event_id FROM evidence_events WHERE session_id = ?)',
    ).bind(session.sessionId).first<{ count: number }>()
    expect(itemCount?.count).toBe(2)
  })

  it('replays the same key and treats a different key for the same unlock as already unlocked', async () => {
    const session = await seedT1Complete()
    const key = crypto.randomUUID()
    const first = await unlock(session, 'A', 'shallow', key)
    const replay = await unlock(session, 'A', 'shallow', key)
    const replayBody = await replay.json()
    const duplicate = await unlock(session, 'A', 'shallow')
    expect([first.status, replay.status, duplicate.status]).toEqual([201, 200, 200])
    expect(replayBody).toMatchObject({ data: {
      created: false, alreadyUnlocked: false, sequenceNo: 8,
      points: { before: 5, cost: 1, after: 4 },
    } })
    expect(await duplicate.json()).toMatchObject({ data: {
      created: false, alreadyUnlocked: true, sequenceNo: 8,
      points: { before: 5, cost: 1, after: 4 },
    } })
    for (const table of ['evidence_events', 'point_ledger']) {
      const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`)
        .bind(session.sessionId).first<{ count: number }>()
      expect(row?.count).toBe(1)
    }
    const run = await db.prepare(
      'SELECT points_remaining, last_sequence_no FROM game_runs WHERE session_id = ?',
    ).bind(session.sessionId).first<Record<string, number>>()
    expect(run).toEqual({ points_remaining: 4, last_sequence_no: 8 })
  })

  it('deducts only once for concurrent same-candidate shallow requests', async () => {
    const session = await seedT1Complete()
    const [left, right] = await Promise.all([
      unlock(session, 'C', 'shallow'),
      unlock(session, 'C', 'shallow'),
    ])
    expect([left.status, right.status].sort()).toEqual([200, 201])
    const bodies = await Promise.all([left.json(), right.json()]) as Array<{ data: Record<string, unknown> }>
    expect(bodies[0].data.sequenceNo).toBe(bodies[1].data.sequenceNo)
    const run = await db.prepare(
      'SELECT points_remaining, last_sequence_no FROM game_runs WHERE session_id = ?',
    ).bind(session.sessionId).first<Record<string, number>>()
    expect(run).toEqual({ points_remaining: 4, last_sequence_no: 8 })
  })

  it('uses the session-bound catalog and returns MATERIAL_NOT_READY when it is missing', async () => {
    const session = await seedT1Complete()
    await db.prepare("UPDATE sessions SET material_version = 'missing-material' WHERE session_id = ?")
      .bind(session.sessionId).run()
    const response = await unlock(session)
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('MATERIAL_NOT_READY')
    const run = await db.prepare('SELECT points_remaining FROM game_runs WHERE session_id = ?')
      .bind(session.sessionId).first<{ points_remaining: number }>()
    expect(run?.points_remaining).toBe(5)
  })

  it('rejects private client fields, invalid levels, unauthenticated requests, and non-POST methods', async () => {
    const session = await seedT1Complete()
    const unknown = await unlock(session, 'A', 'shallow', crypto.randomUUID(), { pointsBefore: 5 })
    expect(unknown.status).toBe(400)
    expect(await unknown.text()).toContain('UNKNOWN_FIELD')
    const invalidLevel = await unlock(session, 'A', 'wide')
    expect(invalidLevel.status).toBe(400)
    expect(await invalidLevel.text()).toContain('INVALID_EVIDENCE_LEVEL')
    const unauthorized = await post('/api/evidence/unlock', unlockBody(session.sessionId))
    expect(unauthorized.status).toBe(401)
    const get = await runtime.dispatchFetch('http://localhost/api/evidence/unlock')
    expect(get.status).toBe(405)
    expect(get.headers.get('Allow')).toBe('POST')
  })

  it('rejects expired sessions without writing evidence or deducting points', async () => {
    const session = await seedT1Complete({ deadlineAt: new Date(Date.now() - 1_000).toISOString() })
    const response = await unlock(session)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('GAME_EXPIRED')
    const count = await db.prepare('SELECT COUNT(*) AS count FROM evidence_events WHERE session_id = ?')
      .bind(session.sessionId).first<{ count: number }>()
    expect(count?.count).toBe(0)
  })

  it('rejects a deduction when the point ledger is inconsistent and increments error_count', async () => {
    const session = await seedT1Complete({ points: 4 })
    const response = await unlock(session)
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('POINT_LEDGER_INCONSISTENT')
    const row = await db.prepare(`SELECT s.error_count, g.points_remaining
      FROM sessions s JOIN game_runs g USING (session_id) WHERE s.session_id = ?`)
      .bind(session.sessionId).first<Record<string, number>>()
    expect(row).toEqual({ error_count: 1, points_remaining: 4 })
  })
})
