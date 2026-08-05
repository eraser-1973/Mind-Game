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

async function createT1Complete(): Promise<FormalSession> {
  const response = await post('/api/sessions', {
    mode: 'formal', identity: { fullName: 'T2 T3 API Test' }, clientVersion: 'stage-5-test',
  })
  const payload = await response.json() as { data: { sessionId: string; participantId: string } }
  const session = {
    ...payload.data,
    cookie: (response.headers.get('Set-Cookie') ?? '').split(';')[0],
  }
  const now = new Date().toISOString()
  const deadline = new Date(Date.now() + 900_000).toISOString()
  const ratings = ['A', 'B', 'C', 'D', 'E'].map((candidateId, index) =>
    db.prepare(`INSERT INTO stage_ratings (
      rating_id, event_id, session_id, candidate_id, stage, rating_value,
      evidence_ids_seen, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, ?, 'T1', ?, json('[]'), ?, ?, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, candidateId, 40 + index, now, now, index + 2))
  await db.batch([
    db.prepare(`UPDATE sessions SET current_step='playing', started_at=?, deadline_at=?
      WHERE session_id=?`).bind(now, deadline, session.sessionId),
    db.prepare(`INSERT INTO game_runs (
      session_id, start_event_id, current_stage, duration_sec, points_total,
      points_remaining, last_sequence_no, started_at, deadline_at,
      t1_completed_at, updated_at
    ) VALUES (?, ?, 'T1_COMPLETE', 900, 5, 5, 7, ?, ?, ?, ?)`)
      .bind(session.sessionId, crypto.randomUUID(), now, deadline, now, now),
    ...ratings,
    db.prepare(`INSERT INTO stage_choices (
      choice_id, event_id, session_id, stage, candidate_id, confidence,
      submit_mode, client_submitted_at, server_submitted_at, sequence_no
    ) VALUES (?, ?, ?, 'T1', 'B', 70, 'active', ?, ?, 7)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, now, now),
  ])
  return session
}

async function unlock(session: FormalSession, candidateId: string, level: 'shallow' | 'deep', key = crypto.randomUUID()) {
  return post('/api/evidence/unlock', {
    sessionId: session.sessionId,
    candidateId,
    level,
    clientAt: new Date().toISOString(),
    clientSequence: 8,
  }, session.cookie, key)
}

async function rate(
  session: FormalSession,
  candidateId: string,
  stage: 'T2' | 'T3',
  ratingValue = 60,
  key = crypto.randomUUID(),
  extra: Record<string, unknown> = {},
) {
  return post('/api/ratings', {
    sessionId: session.sessionId,
    candidateId,
    stage,
    ratingValue,
    clientSubmittedAt: new Date().toISOString(),
    clientSequence: 9,
    ...extra,
  }, session.cookie, key)
}

async function choose(
  session: FormalSession,
  stage: 'T2' | 'T3',
  candidateId = 'B',
  confidence = 75,
  key = crypto.randomUUID(),
) {
  return post('/api/stage-choices', {
    sessionId: session.sessionId,
    stage,
    candidateId,
    confidence,
    clientSubmittedAt: new Date().toISOString(),
    clientSequence: 10,
  }, session.cookie, key)
}

describe('formal T2 ratings and stage choice', () => {
  it('opens T2 only for a shallow-verified candidate and derives evidence IDs on the server', async () => {
    const session = await createT1Complete()
    const unavailable = await rate(session, 'B', 'T2')
    expect(unavailable.status).toBe(409)
    expect(await unavailable.text()).toContain('SHALLOW_EVIDENCE_REQUIRED')

    await unlock(session, 'B', 'shallow')
    const unknown = await rate(session, 'B', 'T2', 72, crypto.randomUUID(), {
      evidenceIdsSeen: ['forged'],
    })
    expect(unknown.status).toBe(400)
    expect(await unknown.text()).toContain('UNKNOWN_FIELD')

    const key = crypto.randomUUID()
    const saved = await rate(session, 'B', 'T2', 72, key)
    expect(saved.status).toBe(201)
    expect(await saved.json()).toMatchObject({ data: {
      created: true,
      candidateId: 'B',
      stage: 'T2',
      ratingValue: 72,
      evidenceIdsSeen: ['B-t2-1', 'B-t2-2'],
      sequenceNo: 9,
      sealed: true,
    } })
    const replay = await rate(session, 'B', 'T2', 1, key)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ data: {
      created: false, ratingValue: 72, sequenceNo: 9,
    } })
    const overwrite = await rate(session, 'B', 'T2', 99)
    expect(overwrite.status).toBe(409)
    expect(await overwrite.text()).toContain('RATING_ALREADY_SEALED')
  })

  it('allows additional shallow verification while rejecting the removed T2 candidate choice', async () => {
    const session = await createT1Complete()
    await unlock(session, 'B', 'shallow')
    await unlock(session, 'D', 'shallow')
    await rate(session, 'B', 'T2', 75)
    await rate(session, 'D', 'T2', 74)

    const removedChoice = await choose(session, 'T2', 'B', 80)
    expect(removedChoice.status).toBe(409)
    expect(await removedChoice.text()).toContain('T2_STAGE_CHOICE_REMOVED')
    const additionalShallow = await unlock(session, 'E', 'shallow')
    expect(additionalShallow.status).toBe(201)
    const lateRating = await rate(session, 'B', 'T2', 90)
    expect(lateRating.status).toBe(409)
    expect(await lateRating.text()).toContain('RATING_ALREADY_SEALED')
  })
})

describe('formal deep evidence and T3', () => {
  it('removes the T2 choice while still requiring shallow evidence and a sealed T2 rating before deep unlock', async () => {
    const session = await createT1Complete()
    await unlock(session, 'B', 'shallow')

    const removedChoice = await choose(session, 'T2')
    expect(removedChoice.status).toBe(409)
    expect(await removedChoice.text()).toContain('T2_STAGE_CHOICE_REMOVED')

    const missingT2Rating = await unlock(session, 'B', 'deep')
    expect(missingT2Rating.status).toBe(409)
    expect(await missingT2Rating.text()).toContain('T2_RATING_REQUIRED')

    await rate(session, 'B', 'T2', 75)
    const deep = await unlock(session, 'B', 'deep')
    expect(deep.status).toBe(201)

    const missingShallow = await unlock(session, 'D', 'deep')
    expect(missingShallow.status).toBe(409)
    expect(await missingShallow.text()).toContain('SHALLOW_EVIDENCE_REQUIRED')
  })

  it('deducts three points for deep evidence and stores T3 with shallow-then-deep evidence IDs', async () => {
    const session = await createT1Complete()
    await unlock(session, 'B', 'shallow')
    await rate(session, 'B', 'T2', 75)
    const deep = await unlock(session, 'B', 'deep')
    expect(deep.status).toBe(201)
    expect(await deep.json()).toMatchObject({ data: {
      candidateId: 'B', level: 'deep', ratingStage: 'T3', sequenceNo: 10,
      points: { before: 4, cost: 3, after: 1, total: 5 },
      currentStage: 'T3', stageStatus: 'T3_ACTIVE',
      evidence: [
        { id: 'B-t3-1', order: 1 },
        { id: 'B-t3-2', order: 2 },
      ],
    } })
    const t3 = await rate(session, 'B', 'T3', 86)
    expect(t3.status).toBe(201)
    expect(await t3.json()).toMatchObject({ data: {
      candidateId: 'B', stage: 'T3', ratingValue: 86, sequenceNo: 11,
      evidenceIdsSeen: ['B-t2-1', 'B-t2-2', 'B-t3-1', 'B-t3-2'],
    } })
    const choice = await choose(session, 'T3', 'B', 88)
    expect(choice.status).toBe(201)
    expect(await choice.json()).toMatchObject({ data: {
      stage: 'T3', currentStage: 'T3', stageStatus: 'T3_COMPLETE', sequenceNo: 12,
    } })
    const lateDeep = await unlock(session, 'B', 'deep', crypto.randomUUID())
    expect(lateDeep.status).toBe(200)
    const newDeep = await unlock(session, 'D', 'deep')
    expect(newDeep.status).toBe(409)
    expect(await newDeep.text()).toContain('T3_STAGE_ALREADY_SEALED')
  })

  it('requires every deep candidate to have T3 before the T3 choice', async () => {
    const session = await createT1Complete()
    // This fixture deliberately expands the published rule for one isolated
    // scenario; Stage 10 seals published rules, so the test explicitly removes
    // and restores that guard instead of weakening production immutability.
    await db.prepare('DROP TRIGGER point_rules_published_no_update').run()
    await db.prepare('PRAGMA ignore_check_constraints = ON').run()
    await db.prepare('UPDATE game_runs SET points_remaining = 9, points_total = 9 WHERE session_id = ?')
      .bind(session.sessionId).run()
    await db.prepare("UPDATE point_rules SET total_points = 9 WHERE point_rule_version = 'points-5-v1'")
      .run()
    await db.prepare('PRAGMA ignore_check_constraints = OFF').run()
    await unlock(session, 'A', 'shallow')
    await unlock(session, 'C', 'shallow')
    await rate(session, 'A', 'T2', 55)
    await rate(session, 'C', 'T2', 60)
    await unlock(session, 'A', 'deep')
    await unlock(session, 'C', 'deep')
    await rate(session, 'A', 'T3', 45)
    const incomplete = await choose(session, 'T3', 'A')
    expect(incomplete.status).toBe(409)
    expect(await incomplete.text()).toContain('T3_RATINGS_INCOMPLETE')
    await rate(session, 'C', 'T3', 58)
    expect((await choose(session, 'T3', 'A')).status).toBe(201)
    await db.prepare("UPDATE point_rules SET total_points = 5 WHERE point_rule_version = 'points-5-v1'").run()
    await db.prepare(`CREATE TRIGGER point_rules_published_no_update
      BEFORE UPDATE ON point_rules
      WHEN OLD.status = 'published'
      BEGIN SELECT RAISE(ABORT, 'published point rules are immutable'); END`).run()
  })

  it('allows only one competing deep unlock to consume the last three points', async () => {
    const session = await createT1Complete()
    await unlock(session, 'B', 'shallow')
    await unlock(session, 'D', 'shallow')
    await rate(session, 'B', 'T2', 75)
    await rate(session, 'D', 'T2', 76)
    const [left, right] = await Promise.all([
      unlock(session, 'B', 'deep'),
      unlock(session, 'D', 'deep'),
    ])
    expect([left.status, right.status].sort()).toEqual([201, 409])
    const failed = left.status === 409 ? left : right
    expect(await failed.text()).toContain('INSUFFICIENT_POINTS')
    const run = await db.prepare('SELECT points_remaining FROM game_runs WHERE session_id = ?')
      .bind(session.sessionId).first<{ points_remaining: number }>()
    expect(run?.points_remaining).toBe(0)
    const ledger = await db.prepare('SELECT COUNT(*) AS count FROM point_ledger WHERE session_id = ?')
      .bind(session.sessionId).first<{ count: number }>()
    expect(ledger?.count).toBe(3)
  })
})

describe('Stage 5 formal resume', () => {
  it('restores ordered T1/T2/T3 ratings, choices, public unlocks, points, and derived stage status', async () => {
    const session = await createT1Complete()
    await unlock(session, 'B', 'shallow')
    await rate(session, 'B', 'T2', 75)
    await unlock(session, 'B', 'deep')
    await rate(session, 'B', 'T3', 86)

    const response = await runtime.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    const payload = await response.json() as { data: { game: Record<string, unknown> } }
    expect(response.status).toBe(200)
    expect(payload.data.game).toMatchObject({
      currentStage: 'T3',
      stageStatus: 'T3_ACTIVE',
      points: { total: 5, remaining: 1 },
      stageChoices: [
        { stage: 'T1', candidateId: 'B' },
      ],
      evidenceUnlocks: [
        { candidateId: 'B', level: 'shallow', evidence: [{ id: 'B-t2-1' }, { id: 'B-t2-2' }] },
        { candidateId: 'B', level: 'deep', evidence: [{ id: 'B-t3-1' }, { id: 'B-t3-2' }] },
      ],
    })
    const ratings = payload.data.game.ratings as Array<Record<string, unknown>>
    expect(ratings).toHaveLength(7)
    expect(ratings.slice(0, 5).every((rating) =>
      rating.stage === 'T1' && JSON.stringify(rating.evidenceIdsSeen) === '[]')).toBe(true)
    expect(ratings[5]).toMatchObject({
      candidateId: 'B', stage: 'T2', evidenceIdsSeen: ['B-t2-1', 'B-t2-2'],
    })
    expect(ratings[6]).toMatchObject({
      candidateId: 'B', stage: 'T3',
      evidenceIdsSeen: ['B-t2-1', 'B-t2-2', 'B-t3-1', 'B-t3-2'],
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('is_key_risk')
    expect(serialized).not.toContain('contains_key_risk')
    expect(serialized).not.toContain('A-t2-1')
  })
})
