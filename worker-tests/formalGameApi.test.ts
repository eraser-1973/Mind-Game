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
    identity: { fullName: 'Formal Game Test' },
    clientVersion: 'stage-4-test',
  })
  const payload = await response.json() as { data: { sessionId: string; participantId: string } }
  return {
    ...payload.data,
    cookie: (response.headers.get('Set-Cookie') ?? '').split(';')[0],
  }
}

async function makeGameReady(): Promise<FormalSession> {
  const session = await createSession()
  const now = new Date().toISOString()
  await db.prepare('PRAGMA ignore_check_constraints = ON').run()
  const submissionId = crypto.randomUUID()
  await db.batch([
    db.prepare(`INSERT INTO consent_records (
      consent_id, event_id, session_id, consent_version, accepted,
      client_accepted_at, server_accepted_at
    ) VALUES (?, ?, ?, 'consent-1.0.0', 1, ?, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, now, now),
    db.prepare(`INSERT INTO demographic_revisions (
      demographic_revision_id, event_id, session_id, revision_no, is_current,
      age_range, gender, education, grade, major_category,
      related_experience_json, client_submitted_at, server_submitted_at
    ) VALUES (?, ?, ?, 1, 1, 'test', 'test', 'test', 'test', 'test',
      json('["test"]'), ?, ?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, now, now),
    db.prepare(`INSERT INTO questionnaire_submissions (
      submission_id, event_id, session_id, phase, instrument_version,
      client_started_at, client_submitted_at, server_submitted_at, item_count
    ) VALUES (?, ?, ?, 'pre', 'state-assessment-pre-1.0.0', ?, ?, ?, 5)`)
      .bind(submissionId, crypto.randomUUID(), session.sessionId, now, now, now),
    ...['stress', 'fatigue', 'attention', 'mood', 'physicalDiscomfort'].map(
      (itemId, value) => db.prepare(`INSERT INTO questionnaire_answers (
        answer_id, submission_id, item_id, value, touched, answered_at
      ) VALUES (?, ?, ?, ?, 1, ?)`)
        .bind(crypto.randomUUID(), submissionId, itemId, value, now),
    ),
    db.prepare("UPDATE sessions SET current_step = 'game_ready' WHERE session_id = ?")
      .bind(session.sessionId),
  ])
  await db.prepare('PRAGMA ignore_check_constraints = OFF').run()
  return session
}

function startBody(sessionId: string) {
  return { sessionId, clientStartedAt: new Date().toISOString(), clientVersion: 'stage-4-test' }
}

async function start(session: FormalSession, key = crypto.randomUUID()) {
  return post(`/api/sessions/${session.sessionId}/start`, startBody(session.sessionId), session.cookie, key)
}

async function rate(
  session: FormalSession,
  candidateId: string,
  ratingValue = 50,
  key = crypto.randomUUID(),
  extra: Record<string, unknown> = {},
) {
  return post('/api/ratings', {
    sessionId: session.sessionId,
    candidateId,
    stage: 'T1',
    ratingValue,
    clientSubmittedAt: new Date().toISOString(),
    clientSequence: 1,
    ...extra,
  }, session.cookie, key)
}

async function rateAll(session: FormalSession) {
  const responses: Awaited<ReturnType<typeof post>>[] = []
  for (const [index, candidateId] of ['A', 'B', 'C', 'D', 'E'].entries()) {
    responses.push(await rate(session, candidateId, index * 25))
  }
  return responses
}

describe('formal game start', () => {
  it('atomically starts a ready session with one 900-second run and game_start event', async () => {
    const session = await makeGameReady()
    const response = await start(session)
    const payload = await response.json() as { data: Record<string, unknown> }
    expect(response.status).toBe(201)
    expect(payload.data).toMatchObject({
      created: true,
      sessionId: session.sessionId,
      currentStep: 'playing',
      currentStage: 'T1',
      durationSec: 900,
      expired: false,
      points: { total: 5, remaining: 5 },
      ratings: [],
      stageChoice: null,
    })
    const startedAt = Date.parse(payload.data.startedAt as string)
    const deadlineAt = Date.parse(payload.data.deadlineAt as string)
    expect(deadlineAt - startedAt).toBe(900_000)
    const rows = await db.prepare(`SELECT s.current_step, s.started_at, s.deadline_at,
      g.current_stage, g.points_total, g.points_remaining, g.last_sequence_no,
      g.started_at AS run_started_at, g.deadline_at AS run_deadline_at
      FROM sessions s JOIN game_runs g USING (session_id) WHERE s.session_id = ?`)
      .bind(session.sessionId).first<Record<string, unknown>>()
    expect(rows).toMatchObject({
      current_step: 'playing', current_stage: 'T1', points_total: 5,
      points_remaining: 5, last_sequence_no: 1,
      started_at: rows?.run_started_at, deadline_at: rows?.run_deadline_at,
    })
  })

  it('replays the same idempotency key without resetting time or adding rows', async () => {
    const session = await makeGameReady()
    const key = crypto.randomUUID()
    const first = await start(session, key)
    const second = await start(session, key)
    const firstBody = await first.json() as { data: Record<string, unknown> }
    const secondBody = await second.json() as { data: Record<string, unknown> }
    expect([first.status, second.status]).toEqual([201, 200])
    expect(secondBody.data).toMatchObject({
      created: false,
      startedAt: firstBody.data.startedAt,
      deadlineAt: firstBody.data.deadlineAt,
    })
    for (const table of ['game_runs', 'game_events']) {
      const count = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`)
        .bind(session.sessionId).first<{ count: number }>()
      expect(count?.count).toBe(1)
    }
  })

  it('rejects incomplete intake, wrong cookie, and a second start key', async () => {
    const incomplete = await createSession()
    expect((await start(incomplete)).status).toBe(409)
    const ready = await makeGameReady()
    expect((await post(`/api/sessions/${ready.sessionId}/start`, startBody(ready.sessionId), '')).status).toBe(401)
    await start(ready)
    const second = await start(ready)
    expect(second.status).toBe(409)
  })
})

describe('formal T1 ratings', () => {
  it.each([0, 100])('seals boundary rating %s and creates matching monotonic events', async (ratingValue) => {
    const session = await makeGameReady()
    await start(session)
    const response = await rate(session, 'A', ratingValue)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: {
      created: true, candidateId: 'A', stage: 'T1', ratingValue,
      sealed: true, sequenceNo: 2, ratedCandidateCount: 1,
      requiredCandidateCount: 5, allT1Rated: false,
    } })
    const row = await db.prepare(`SELECT r.sequence_no, r.evidence_ids_seen,
      e.server_sequence FROM stage_ratings r JOIN game_events e USING (event_id)`)
      .first<Record<string, unknown>>()
    expect(row).toEqual({ sequence_no: 2, evidence_ids_seen: '[]', server_sequence: 2 })
  })

  it.each([
    [-1, 'INVALID_RATING'],
    [101, 'INVALID_RATING'],
    [1.5, 'INVALID_RATING'],
  ])('rejects invalid rating %s', async (ratingValue, code) => {
    const session = await makeGameReady()
    await start(session)
    const response = await rate(session, 'A', ratingValue)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(code)
  })

  it.each(['T2', 'T3'])('rejects unavailable stage %s', async (stage) => {
    const session = await makeGameReady()
    await start(session)
    const response = await rate(session, 'A', 50, crypto.randomUUID(), { stage })
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('RATING_STAGE_NOT_AVAILABLE')
  })

  it('rejects client evidence and seals one candidate against a different key', async () => {
    const session = await makeGameReady()
    await start(session)
    const unknown = await rate(session, 'A', 50, crypto.randomUUID(), { evidenceIdsSeen: [] })
    expect(unknown.status).toBe(400)
    expect(await unknown.text()).toContain('UNKNOWN_FIELD')
    const key = crypto.randomUUID()
    expect((await rate(session, 'A', 50, key)).status).toBe(201)
    const replay = await rate(session, 'A', 99, key)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ data: { created: false, ratingValue: 50, sequenceNo: 2 } })
    const overwrite = await rate(session, 'A', 99)
    expect(overwrite.status).toBe(409)
    expect(await overwrite.text()).toContain('RATING_ALREADY_SEALED')
  })

  it('stores five independent ratings and reports allT1Rated on the fifth', async () => {
    const session = await makeGameReady()
    await start(session)
    const responses = await rateAll(session)
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201])
    expect(await responses[4].json()).toMatchObject({ data: {
      ratedCandidateCount: 5, allT1Rated: true, sequenceNo: 6,
    } })
    const count = await db.prepare('SELECT COUNT(*) AS count FROM stage_ratings WHERE session_id = ?')
      .bind(session.sessionId).first<{ count: number }>()
    expect(count?.count).toBe(5)
  })
})

describe('T1 stage choice, expiry, and resume', () => {
  async function choose(session: FormalSession, confidence = 70, key = crypto.randomUUID(), stage = 'T1') {
    return post('/api/stage-choices', {
      sessionId: session.sessionId,
      stage,
      candidateId: 'B',
      confidence,
      clientSubmittedAt: new Date().toISOString(),
      clientSequence: 6,
    }, session.cookie, key)
  }

  it('requires five ratings then seals T1 choice and advances to T1_COMPLETE', async () => {
    const session = await makeGameReady()
    await start(session)
    const incomplete = await choose(session)
    expect(incomplete.status).toBe(409)
    expect(await incomplete.text()).toContain('T1_RATINGS_INCOMPLETE')
    await rateAll(session)
    const response = await choose(session, 0)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: {
      created: true, stage: 'T1', candidateId: 'B', confidence: 0,
      sealed: true, currentStage: 'T1_COMPLETE', sequenceNo: 7,
    } })
    const run = await db.prepare(`SELECT current_stage, t1_completed_at,
      last_sequence_no FROM game_runs WHERE session_id = ?`)
      .bind(session.sessionId).first<Record<string, unknown>>()
    expect(run).toMatchObject({ current_stage: 'T1_COMPLETE', last_sequence_no: 7 })
    expect(run?.t1_completed_at).toEqual(expect.any(String))
  })

  it.each([-1, 101, 1.5])('rejects invalid confidence %s', async (confidence) => {
    const session = await makeGameReady()
    await start(session)
    await rateAll(session)
    expect((await choose(session, confidence)).status).toBe(400)
  })

  it.each(['T2', 'T3', 'final'])('rejects future choice stage %s', async (stage) => {
    const session = await makeGameReady()
    await start(session)
    await rateAll(session)
    const response = await choose(session, 50, crypto.randomUUID(), stage)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('CHOICE_STAGE_NOT_AVAILABLE')
  })

  it('replays a choice without adding sequence and rejects a new key', async () => {
    const session = await makeGameReady()
    await start(session)
    await rateAll(session)
    const key = crypto.randomUUID()
    expect((await choose(session, 70, key)).status).toBe(201)
    expect((await choose(session, 99, key)).status).toBe(200)
    const overwrite = await choose(session, 99)
    expect(overwrite.status).toBe(409)
    expect(await overwrite.text()).toContain('STAGE_CHOICE_ALREADY_SEALED')
    const run = await db.prepare('SELECT last_sequence_no FROM game_runs WHERE session_id = ?')
      .bind(session.sessionId).first<{ last_sequence_no: number }>()
    expect(run?.last_sequence_no).toBe(7)
  })

  it('resumes partial and completed T1 in server sequence without resetting deadline', async () => {
    const session = await makeGameReady()
    const started = await start(session)
    const startedData = (await started.json() as { data: { deadlineAt: string } }).data
    await rate(session, 'D', 82)
    await rate(session, 'A', 40)
    let response = await runtime.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { game: {
      started: true, resumeSupported: true, currentStage: 'T1',
      deadlineAt: startedData.deadlineAt, points: { total: 5, remaining: 5 },
      ratings: [
        { candidateId: 'D', ratingValue: 82, sealed: true, sequenceNo: 2 },
        { candidateId: 'A', ratingValue: 40, sealed: true, sequenceNo: 3 },
      ],
      stageChoice: null,
    } } })
    for (const candidate of ['B', 'C', 'E']) await rate(session, candidate, 50)
    await choose(session)
    response = await runtime.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    expect(await response.json()).toMatchObject({ data: { game: {
      currentStage: 'T1_COMPLETE',
      stageChoice: { stage: 'T1', candidateId: 'B', confidence: 70, sealed: true },
    } } })
  })

  it('rejects writes after server deadline and records expiry once without completing', async () => {
    const session = await makeGameReady()
    await start(session)
    await db.prepare(`UPDATE sessions SET started_at = ?, deadline_at = ? WHERE session_id = ?`)
      .bind('2019-12-31T23:45:00.000Z', '2020-01-01T00:00:00.000Z', session.sessionId).run()
    await db.prepare(`UPDATE game_runs SET started_at = ?, deadline_at = ? WHERE session_id = ?`)
      .bind('2019-12-31T23:45:00.000Z', '2020-01-01T00:00:00.000Z', session.sessionId).run()
    const first = await rate(session, 'A', 50)
    const second = await rate(session, 'B', 50)
    expect([first.status, second.status]).toEqual([409, 409])
    expect(await first.text()).toContain('GAME_TIME_EXPIRED')
    const state = await db.prepare(`SELECT s.completion_status, g.time_expired_at,
      g.last_sequence_no FROM sessions s JOIN game_runs g USING (session_id)
      WHERE s.session_id = ?`).bind(session.sessionId).first<Record<string, unknown>>()
    expect(state).toMatchObject({ completion_status: 'in_progress', last_sequence_no: 2 })
    expect(state?.time_expired_at).toEqual(expect.any(String))
    const count = await db.prepare(`SELECT COUNT(*) AS count FROM game_events
      WHERE session_id = ? AND event_type = 'timer_expired'`)
      .bind(session.sessionId).first<{ count: number }>()
    expect(count?.count).toBe(1)
    const resume = await runtime.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    expect(await resume.json()).toMatchObject({ data: { game: { expired: true, remainingSec: 0 } } })
  })
})

describe('formal game request guards', () => {
  it('returns JSON 404 and method guards without leaking internals', async () => {
    const unknown = await runtime.dispatchFetch('http://localhost/api/game-unknown')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('Content-Type')).toContain('application/json')
    const ratingGet = await runtime.dispatchFetch('http://localhost/api/ratings')
    expect(ratingGet.status).toBe(405)
    expect(ratingGet.headers.get('Allow')).toBe('POST')
  })

  it('rejects non-JSON, missing key, oversized body, and quick-shaped requests', async () => {
    const session = await makeGameReady()
    const nonJson = await runtime.dispatchFetch('http://localhost/api/ratings', {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: session.cookie }, body: '{}',
    })
    const missing = await runtime.dispatchFetch('http://localhost/api/ratings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
      body: JSON.stringify({}),
    })
    const oversized = await rate(session, 'A', 50, crypto.randomUUID(), { padding: 'x'.repeat(17 * 1024) })
    const quick = await post('/api/ratings', {
      sessionId: crypto.randomUUID(), candidateId: 'A', stage: 'T1', ratingValue: 50,
      clientSubmittedAt: new Date().toISOString(), mode: 'quick',
    }, '')
    expect(nonJson.status).toBe(400)
    expect(missing.status).toBe(400)
    expect(oversized.status).toBe(413)
    expect(quick.status).toBe(400)
    const text = await quick.text()
    expect(text).not.toMatch(/SQL|stack|database_id|D:\\/i)
  })
})
