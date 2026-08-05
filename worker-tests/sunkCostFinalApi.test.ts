import type { Miniflare } from 'miniflare'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkerRuntime } from './runtime'

type TestSession = { sessionId: string; cookie: string }

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

async function createSession(): Promise<TestSession> {
  const response = await post('/api/sessions', {
    mode: 'formal', identity: { studentId: `S6-${crypto.randomUUID()}` }, clientVersion: 'stage6-test',
  })
  const payload = await response.json() as { data: { sessionId: string } }
  return {
    sessionId: payload.data.sessionId,
    cookie: (response.headers.get('Set-Cookie') ?? '').split(';')[0],
  }
}

async function seedRun(options: {
  remainingSec?: number
  stage?: 'T1_COMPLETE' | 'T2' | 'T3'
  t2Choice?: boolean
  t3Choice?: boolean
  riskCandidate?: 'A' | 'C' | null
  riskPoints?: number
} = {}) {
  const session = await createSession()
  const now = new Date()
  const remainingSec = options.remainingSec ?? 250
  const deadlineAt = new Date(now.getTime() + remainingSec * 1000).toISOString()
  const startedAt = new Date(Date.parse(deadlineAt) - 900_000).toISOString()
  const riskPoints = options.riskPoints ?? 0
  const lastSequence = 7 + (riskPoints > 0 ? 1 : 0) + (options.t2Choice ? 1 : 0) + (options.t3Choice ? 1 : 0)
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE sessions SET current_step='playing', started_at=?, deadline_at=? WHERE session_id=?`)
      .bind(startedAt, deadlineAt, session.sessionId),
    db.prepare(`INSERT INTO game_runs (
      session_id,start_event_id,current_stage,duration_sec,points_total,points_remaining,
      last_sequence_no,started_at,deadline_at,t1_completed_at,updated_at
    ) VALUES (?,? ,?,900,5,?, ?,?,?,?,?)`)
      .bind(session.sessionId, crypto.randomUUID(), options.stage ?? 'T2', 5 - riskPoints,
        lastSequence, startedAt, deadlineAt, now.toISOString(), now.toISOString()),
  ]
  for (const [index, candidateId] of ['A', 'B', 'C', 'D', 'E'].entries()) {
    statements.push(db.prepare(`INSERT INTO stage_ratings (
      rating_id,event_id,session_id,candidate_id,stage,rating_value,evidence_ids_seen,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,?,'T1',50,json('[]'),?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, candidateId,
        now.toISOString(), now.toISOString(), index + 1))
  }
  statements.push(db.prepare(`INSERT INTO stage_choices (
    choice_id,event_id,session_id,stage,candidate_id,confidence,submit_mode,
    client_submitted_at,server_submitted_at,sequence_no
  ) VALUES (?,?,?,'T1','B',60,'active',?,?,7)`)
    .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, now.toISOString(), now.toISOString()))
  let sequence = 7
  if (riskPoints > 0 && options.riskCandidate) {
    sequence += 1
    const candidateId = options.riskCandidate
    const evidenceId = `${candidateId}-t2-1`
    const eventId = crypto.randomUUID()
    statements.push(
      db.prepare(`INSERT INTO evidence_events (
        event_id,session_id,candidate_id,evidence_level,rating_stage,material_version,
        point_rule_version,evidence_ids_json,points_before,points_cost,points_after,
        contains_key_risk,client_at,server_at,sequence_no
      ) VALUES (?,?,?,'shallow','T2','material-1.0.0','points-5-v1',json(?),5,?, ?,1,?,?,?)`)
        .bind(eventId, session.sessionId, candidateId, JSON.stringify([evidenceId]), riskPoints,
          5 - riskPoints, now.toISOString(), now.toISOString(), sequence),
      db.prepare(`INSERT INTO evidence_event_items (event_id,material_version,evidence_id,item_order)
        VALUES (?,'material-1.0.0',?,1)`).bind(eventId, evidenceId),
      db.prepare(`INSERT INTO point_ledger (
        ledger_id,session_id,event_id,reason,candidate_id,evidence_level,points_before,
        points_delta,points_after,sequence_no,created_at
      ) VALUES (?,?,?,'evidence_unlock',?,'shallow',5,?,?,?,?)`)
        .bind(crypto.randomUUID(), session.sessionId, eventId, candidateId, -riskPoints,
          5 - riskPoints, sequence, now.toISOString()),
    )
  }
  if (options.t2Choice) {
    sequence += 1
    statements.push(db.prepare(`INSERT INTO stage_choices (
      choice_id,event_id,session_id,stage,candidate_id,confidence,submit_mode,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,'T2','D',72,'active',?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId,
        now.toISOString(), now.toISOString(), sequence))
  }
  if (options.t3Choice) {
    sequence += 1
    statements.push(db.prepare(`INSERT INTO stage_choices (
      choice_id,event_id,session_id,stage,candidate_id,confidence,submit_mode,
      client_submitted_at,server_submitted_at,sequence_no
    ) VALUES (?,?,?,'T3','E',81,'active',?,?,?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId,
        now.toISOString(), now.toISOString(), sequence))
  }
  await db.batch(statements)
  return session
}

const now = () => new Date().toISOString()

describe('sunk cost show API', () => {
  it('returns required false without persisting when the server rule is not eligible', async () => {
    const session = await seedRun({ remainingSec: 600, riskCandidate: 'A', riskPoints: 2 })
    const response = await post('/api/sunk-cost/show', {
      sessionId: session.sessionId, clientShownAt: now(), clientSequence: 10,
    }, session.cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { required: false, triggered: false } })
    const row = await db.prepare('SELECT COUNT(*) count FROM sunk_cost_events WHERE session_id=?')
      .bind(session.sessionId).first<{ count: number }>()
    expect(row?.count).toBe(0)
  })

  it('creates one server-selected prompt and replays the same event id', async () => {
    const session = await seedRun({ riskCandidate: 'A', riskPoints: 2 })
    const key = crypto.randomUUID()
    const body = { sessionId: session.sessionId, clientShownAt: now(), clientSequence: 10 }
    const first = await post('/api/sunk-cost/show', body, session.cookie, key)
    const replay = await post('/api/sunk-cost/show', body, session.cookie, key)
    expect([first.status, replay.status]).toEqual([201, 200])
    const payload = await first.json() as { data: Record<string, unknown> }
    expect(payload.data).toMatchObject({
      created: true, required: true, triggered: true, targetCandidateId: 'A',
      pointsInvestedBefore: 2,
    })
    expect(JSON.stringify(payload)).not.toContain('riskEvidenceIds')
    const rows = await db.prepare('SELECT COUNT(*) count FROM sunk_cost_events WHERE session_id=?')
      .bind(session.sessionId).first<{ count: number }>()
    expect(rows?.count).toBe(1)
  })

  it('returns one created result for concurrent requests with the same show event id', async () => {
    const session = await seedRun({ riskCandidate: 'A', riskPoints: 2 })
    const key = crypto.randomUUID()
    const body = { sessionId: session.sessionId, clientShownAt: now() }
    const responses = await Promise.all([
      post('/api/sunk-cost/show', body, session.cookie, key),
      post('/api/sunk-cost/show', body, session.cookie, key),
    ])
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201])
  })
})

describe('sunk cost choice API', () => {
  it('blocks evidence and rating writes while the prompt is pending', async () => {
    const session = await seedRun({ riskCandidate: 'A', riskPoints: 2 })
    await post('/api/sunk-cost/show', {
      sessionId: session.sessionId, clientShownAt: now(),
    }, session.cookie)
    const evidence = await post('/api/evidence/unlock', {
      sessionId: session.sessionId, candidateId: 'B', level: 'shallow', clientAt: now(),
    }, session.cookie)
    const rating = await post('/api/ratings', {
      sessionId: session.sessionId, candidateId: 'A', stage: 'T2', ratingValue: 40,
      clientSubmittedAt: now(),
    }, session.cookie)
    expect([evidence.status, rating.status]).toEqual([409, 409])
    expect(await evidence.text()).toContain('SUNK_COST_RESPONSE_REQUIRED')
    expect(await rating.text()).toContain('SUNK_COST_RESPONSE_REQUIRED')
  })

  it.each(['continue', 'stop_loss', 'give_up'] as const)('seals %s exactly once', async (choice) => {
    const session = await seedRun({ riskCandidate: 'C', riskPoints: 2 })
    const shown = await post('/api/sunk-cost/show', {
      sessionId: session.sessionId, clientShownAt: now(),
    }, session.cookie)
    const shownPayload = await shown.json() as { data: { sunkEventId: string } }
    const key = crypto.randomUUID()
    const body = {
      sessionId: session.sessionId, sunkEventId: shownPayload.data.sunkEventId,
      choice, clientSubmittedAt: now(),
    }
    const first = await post('/api/sunk-cost/choice', body, session.cookie, key)
    const replay = await post('/api/sunk-cost/choice', body, session.cookie, key)
    expect([first.status, replay.status]).toEqual([201, 200])
    expect(await first.json()).toMatchObject({ data: { choice, required: false } })
    const other = await post('/api/sunk-cost/choice', body, session.cookie)
    expect(other.status).toBe(409)
    if (choice === 'give_up') {
      const run = await db.prepare('SELECT current_stage FROM game_runs WHERE session_id=?')
        .bind(session.sessionId).first<{ current_stage: string }>()
      expect(run?.current_stage).toBe('DECISION')
      const final = await post('/api/final-decision', {
        sessionId: session.sessionId, candidateId: 'B', confidence: 55,
        clientSubmittedAt: now(),
      }, session.cookie)
      expect(final.status).toBe(201)
      expect(await final.json()).toMatchObject({ data: { sourceStage: 'T1', submitMode: 'active' } })
    }
  })
})

describe('final decision APIs', () => {
  it('allows the final decision after rated shallow evidence exhausts deep-verification capacity without a T2 choice', async () => {
    const session = await seedRun({ stage: 'T2', remainingSec: 600 })
    for (const candidateId of ['B', 'D', 'E']) {
      const evidence = await post('/api/evidence/unlock', {
        sessionId: session.sessionId, candidateId, level: 'shallow', clientAt: now(),
      }, session.cookie)
      expect(evidence.status).toBe(201)
      const rating = await post('/api/ratings', {
        sessionId: session.sessionId, candidateId, stage: 'T2', ratingValue: 60,
        clientSubmittedAt: now(),
      }, session.cookie)
      expect(rating.status).toBe(201)
    }

    const final = await post('/api/final-decision', {
      sessionId: session.sessionId, candidateId: 'D', confidence: 70, clientSubmittedAt: now(),
    }, session.cookie)
    expect(final.status).toBe(201)
    expect(await final.json()).toMatchObject({ data: {
      candidateId: 'D', sourceStage: 'T2', submitMode: 'active',
    } })
    const choices = await db.prepare(`SELECT stage FROM stage_choices WHERE session_id=? ORDER BY sequence_no`)
      .bind(session.sessionId).all<{ stage: string }>()
    expect(choices.results).toEqual([{ stage: 'T1' }])
  })

  it('requires the eligible sunk prompt before active final submission', async () => {
    const session = await seedRun({ stage: 'T2', t2Choice: true, riskCandidate: 'A', riskPoints: 2 })
    const response = await post('/api/final-decision', {
      sessionId: session.sessionId, candidateId: 'D', confidence: 70, clientSubmittedAt: now(),
    }, session.cookie)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('SUNK_COST_SHOW_REQUIRED')
  })

  it('seals an active T2 decision and records not_triggered when the trap is ineligible', async () => {
    const session = await seedRun({ stage: 'T2', t2Choice: true, remainingSec: 600 })
    const key = crypto.randomUUID()
    const body = {
      sessionId: session.sessionId, candidateId: 'D', confidence: 0,
      clientSubmittedAt: now(), clientSequence: 10,
    }
    const first = await post('/api/final-decision', body, session.cookie, key)
    const replay = await post('/api/final-decision', body, session.cookie, key)
    expect([first.status, replay.status]).toEqual([201, 200])
    expect(await first.json()).toMatchObject({ data: {
      candidateId: 'D', confidence: 0, submitMode: 'active', sourceStage: 'T2',
      autoSelected: false, currentStep: 'post_task',
    } })
    const state = await db.prepare(`SELECT s.current_step,s.completion_status,s.final_submit_mode,
      g.current_stage,g.finalized_at,sc.choice_status FROM sessions s
      JOIN game_runs g USING(session_id) JOIN sunk_cost_events sc USING(session_id)
      WHERE s.session_id=?`).bind(session.sessionId).first<Record<string, unknown>>()
    expect(state).toMatchObject({ current_step: 'post_task', completion_status: 'in_progress',
      final_submit_mode: 'active', current_stage: 'DECISION', choice_status: 'not_triggered' })

    const resume = await runtime.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    expect(resume.status).toBe(200)
    const resumed = await resume.json() as { data: Record<string, unknown> }
    expect(resumed.data).toMatchObject({
      session: { currentStep: 'post_task', versions: { sunkCostRule: 'sunk-1.0.0' } },
      sunkCost: { triggered: false, choice: 'not_triggered' },
      finalDecision: { candidateId: 'D', submitMode: 'active' },
    })
    for (const privateKey of ['riskEvidenceIdsSeen', 'triggerReason', 'trueAbility', 'isToxic']) {
      expect(JSON.stringify(resumed)).not.toContain(privateKey)
    }
  })

  it.each([
    ['T3', true, true, 'E', 81],
    ['T2', true, false, 'D', 72],
    ['T1', false, false, 'B', 60],
  ] as const)('times out to the latest sealed %s choice', async (_stage, t2Choice, t3Choice, candidate, confidence) => {
    const session = await seedRun({
      stage: t3Choice ? 'T3' : t2Choice ? 'T2' : 'T1_COMPLETE',
      t2Choice, t3Choice, remainingSec: -2,
    })
    const response = await post('/api/final-decision/timeout', {
      sessionId: session.sessionId, clientObservedAt: now(),
    }, session.cookie)
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: {
      candidateId: candidate, confidence, submitMode: 'timeout', sourceStage: _stage,
      autoSelected: true, currentStep: 'post_task',
    } })
    const events = await db.prepare(`SELECT event_type FROM game_events WHERE session_id=?
      AND event_type IN ('timer_expired','final_submit') ORDER BY server_sequence`)
      .bind(session.sessionId).all<{ event_type: string }>()
    expect(events.results.map(({ event_type }) => event_type)).toEqual(['timer_expired', 'final_submit'])
  })

  it('marks an unanswered shown prompt before timeout finalization', async () => {
    const session = await seedRun({ riskCandidate: 'A', riskPoints: 2, remainingSec: 2 })
    await post('/api/sunk-cost/show', { sessionId: session.sessionId, clientShownAt: now() }, session.cookie)
    await db.prepare('UPDATE game_runs SET deadline_at=? WHERE session_id=?')
      .bind(new Date(Date.now() - 1_000).toISOString(), session.sessionId).run()
    await db.prepare('UPDATE sessions SET deadline_at=? WHERE session_id=?')
      .bind(new Date(Date.now() - 1_000).toISOString(), session.sessionId).run()
    const response = await post('/api/final-decision/timeout', {
      sessionId: session.sessionId, clientObservedAt: now(),
    }, session.cookie)
    expect(response.status).toBe(201)
    const row = await db.prepare('SELECT choice_status,choice FROM sunk_cost_events WHERE session_id=?')
      .bind(session.sessionId).first<Record<string, unknown>>()
    expect(row).toEqual({ choice_status: 'timeout_unanswered', choice: null })
  })

  it('rejects timeout before the server deadline', async () => {
    const session = await seedRun({ remainingSec: 500 })
    const response = await post('/api/final-decision/timeout', {
      sessionId: session.sessionId, clientObservedAt: now(),
    }, session.cookie)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('GAME_NOT_EXPIRED')
  })

  it('replays the timeout event after the session has transitioned to timeout', async () => {
    const session = await seedRun({ remainingSec: -2 })
    const key = crypto.randomUUID()
    const body = { sessionId: session.sessionId, clientObservedAt: now() }
    const first = await post('/api/final-decision/timeout', body, session.cookie, key)
    const replay = await post('/api/final-decision/timeout', body, session.cookie, key)
    expect([first.status, replay.status]).toEqual([201, 200])
    const count = await db.prepare('SELECT COUNT(*) count FROM final_decisions WHERE session_id=?')
      .bind(session.sessionId).first<{ count: number }>()
    expect(count?.count).toBe(1)
  })

  it('unifies an expired evidence write into timeout finalization before rejecting it', async () => {
    const session = await seedRun({ stage: 'T2', t2Choice: true, remainingSec: -2 })
    const response = await post('/api/evidence/unlock', {
      sessionId: session.sessionId, candidateId: 'B', level: 'shallow', clientAt: now(),
    }, session.cookie)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('GAME_EXPIRED')
    const final = await db.prepare(`SELECT submit_mode,candidate_id FROM final_decisions
      WHERE session_id=?`).bind(session.sessionId).first<Record<string, unknown>>()
    expect(final).toEqual({ submit_mode: 'timeout', candidate_id: 'D' })
  })
})
