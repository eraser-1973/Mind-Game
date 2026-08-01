import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import { createWorkerRuntime } from './runtime'
import {
  POST_TASK_INSTRUMENT,
  TASK_EXPERIENCE_INSTRUMENT,
} from '../worker/domain/questionnaireInstruments'

type TestSession = { sessionId: string; participantId: string; cookie: string }
let runtime: Miniflare | undefined
let db: D1Database | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  db = undefined
})

async function setup() {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  db = created.db
}

async function createSession(mode: 'active' | 'timeout' = 'active'): Promise<TestSession> {
  const response = await runtime!.dispatchFetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      mode: 'formal',
      identity: { fullName: 'Stage7 Completion Synthetic' },
      clientVersion: 'stage7-test',
    }),
  })
  const payload = await response.json() as {
    data: { sessionId: string; participantId: string }
  }
  const session = {
    ...payload.data,
    cookie: (response.headers.get('Set-Cookie') ?? '').split(';')[0],
  }
  const at = '2026-08-01T01:00:00.000Z'
  await db!.batch([
    db!.prepare(`UPDATE sessions SET current_step='post_task',completion_status=?,
      final_submit_mode=?,started_at='2026-08-01T00:45:00.000Z',
      deadline_at='2026-08-01T01:00:00.000Z' WHERE session_id=?`)
      .bind(mode === 'active' ? 'in_progress' : 'timeout', mode, session.sessionId),
    db!.prepare(`INSERT INTO game_runs (
      session_id,start_event_id,current_stage,duration_sec,points_total,points_remaining,
      last_sequence_no,started_at,deadline_at,time_expired_at,t1_completed_at,
      updated_at,finalized_at
    ) VALUES (?,?,'DECISION',900,5,5,7,'2026-08-01T00:45:00.000Z',
      '2026-08-01T01:00:00.000Z',?,?,?,?)`)
      .bind(session.sessionId, crypto.randomUUID(), mode === 'timeout' ? at : null,
        '2026-08-01T00:50:00.000Z', at, at),
    db!.prepare(`INSERT INTO final_decisions (
      final_decision_id,event_id,session_id,candidate_id,confidence,submit_mode,
      source_stage,selection_origin,auto_selected,client_submitted_at,
      server_submitted_at,sequence_no,remaining_sec_at_submit,
      points_remaining_at_submit,sunk_cost_choice,created_at
    ) VALUES (?,?,?,'B',75,?,'T2',?,?,?, ?,7,60,5,'not_triggered',?)`)
      .bind(crypto.randomUUID(), crypto.randomUUID(), session.sessionId, mode,
        mode === 'active' ? 'active_user' : 'timeout_latest_sealed_choice',
        mode === 'active' ? 0 : 1, mode === 'active' ? at : null, at, at),
  ])
  return session
}

const at = '2026-08-01T01:01:00.000Z'

function answerRows(items: readonly { id: string; min: number }[]) {
  return items.map((item) => ({
    itemId: item.id,
    value: item.min,
    touched: true,
    answeredAt: at,
  }))
}

function questionnaire(session: TestSession, phase: 'post' | 'task_experience') {
  const instrument = phase === 'post' ? POST_TASK_INSTRUMENT : TASK_EXPERIENCE_INSTRUMENT
  return runtime!.dispatchFetch('http://localhost/api/questionnaires', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      Cookie: session.cookie,
    },
    body: JSON.stringify({
      sessionId: session.sessionId,
      phase,
      instrumentVersion: instrument.version,
      clientSubmittedAt: at,
      answers: answerRows(instrument.items),
    }),
  })
}

async function prepareCompletion(mode: 'active' | 'timeout' = 'active') {
  const session = await createSession(mode)
  expect((await questionnaire(session, 'post')).status).toBe(201)
  expect((await questionnaire(session, 'task_experience')).status).toBe(201)
  return session
}

function endSession(
  session: TestSession,
  key = crypto.randomUUID(),
  body: Record<string, unknown> = {
    sessionId: session.sessionId,
    clientCompletedAt: at,
    clientSequence: 10,
  },
) {
  return runtime!.dispatchFetch(
    `http://localhost/api/sessions/${session.sessionId}/end`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        Cookie: session.cookie,
      },
      body: JSON.stringify(body),
    },
  )
}

function resumeSession(session: TestSession) {
  return runtime!.dispatchFetch(
    `http://localhost/api/sessions/${session.sessionId}/resume`,
    { headers: { Cookie: session.cookie } },
  )
}

describe('POST /api/sessions/:sessionId/end', () => {
  it.each([
    ['active', 'completed'],
    ['timeout', 'timeout'],
  ] as const)('atomically completes an %s final as %s', async (mode, expectedStatus) => {
    await setup()
    const session = await prepareCompletion(mode)
    const before = await db!.prepare(`SELECT finalized_at FROM game_runs WHERE session_id=?`)
      .bind(session.sessionId).first<{ finalized_at: string }>()
    const finalBefore = await db!.prepare(`SELECT * FROM final_decisions WHERE session_id=?`)
      .bind(session.sessionId).first<Record<string, unknown>>()

    const response = await endSession(session)
    expect(response.status).toBe(201)
    const payload = await response.json() as { data: Record<string, unknown> }
    expect(payload.data).toMatchObject({
      created: true,
      alreadyCompleted: false,
      sessionId: session.sessionId,
      currentStep: 'completed',
      completionStatus: expectedStatus,
      finalSubmitMode: mode,
      serverCompletedAt: expect.any(String),
      sequenceNo: 10,
    })

    const stored = await db!.prepare(`SELECT s.current_step,s.completion_status,s.ended_at,
      c.server_completed_at,c.sequence_no,c.final_submit_mode
      FROM sessions s JOIN completion_records c ON c.session_id=s.session_id
      WHERE s.session_id=?`).bind(session.sessionId).first<Record<string, unknown>>()
    const run = await db!.prepare(`SELECT finalized_at,last_sequence_no FROM game_runs
      WHERE session_id=?`).bind(session.sessionId).first<Record<string, unknown>>()
    const finalAfter = await db!.prepare(`SELECT * FROM final_decisions WHERE session_id=?`)
      .bind(session.sessionId).first<Record<string, unknown>>()
    expect(stored).toMatchObject({
      current_step: 'completed',
      completion_status: expectedStatus,
      ended_at: payload.data.serverCompletedAt,
      server_completed_at: payload.data.serverCompletedAt,
      sequence_no: 10,
      final_submit_mode: mode,
    })
    expect(run).toEqual({ finalized_at: before?.finalized_at, last_sequence_no: 10 })
    expect(finalAfter).toEqual(finalBefore)
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM game_events
      WHERE session_id=? AND event_type='session_complete'`).bind(session.sessionId)
      .first<{ count: number }>())?.count).toBe(1)
  })

  it('replays the same or a different key without changing sequence or ended_at', async () => {
    await setup()
    const session = await prepareCompletion()
    const key = crypto.randomUUID()
    expect((await endSession(session, key)).status).toBe(201)
    const first = await db!.prepare(`SELECT ended_at FROM sessions WHERE session_id=?`)
      .bind(session.sessionId).first<{ ended_at: string }>()
    const same = await endSession(session, key)
    const different = await endSession(session)
    expect(same.status).toBe(200)
    expect(different.status).toBe(200)
    expect(await same.json()).toMatchObject({
      data: { created: false, alreadyCompleted: true, sequenceNo: 10 },
    })
    expect(await different.json()).toMatchObject({
      data: { created: false, alreadyCompleted: true, sequenceNo: 10 },
    })
    expect((await db!.prepare(`SELECT ended_at FROM sessions WHERE session_id=?`)
      .bind(session.sessionId).first<{ ended_at: string }>())?.ended_at).toBe(first?.ended_at)
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM completion_records
      WHERE session_id=?`).bind(session.sessionId).first<{ count: number }>())?.count).toBe(1)
  })

  it('converges concurrent end calls on one completion and one event', async () => {
    await setup()
    const session = await prepareCompletion()
    const responses = await Promise.all([endSession(session), endSession(session)])
    expect(responses.every(({ status }) => status === 200 || status === 201)).toBe(true)
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM completion_records
      WHERE session_id=?`).bind(session.sessionId).first<{ count: number }>())?.count).toBe(1)
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM game_events
      WHERE session_id=? AND event_type='session_complete'`).bind(session.sessionId)
      .first<{ count: number }>())?.count).toBe(1)
  })

  it('rejects an inconsistent point ledger without ending and increments error_count', async () => {
    await setup()
    const session = await prepareCompletion()
    await db!.prepare(`UPDATE game_runs SET points_remaining=4 WHERE session_id=?`)
      .bind(session.sessionId).run()
    const response = await endSession(session)
    expect(response.status).toBe(500)
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain('SESSION_DATA_INCONSISTENT')
    expect(serialized).not.toMatch(/SQL|constraint|D:\\|Cookie|Stage7 Completion Synthetic/i)
    expect((await db!.prepare(`SELECT ended_at,error_count FROM sessions WHERE session_id=?`)
      .bind(session.sessionId).first<{ ended_at: string | null; error_count: number }>()))
      .toEqual({ ended_at: null, error_count: 1 })
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM completion_records
      WHERE session_id=?`).bind(session.sessionId).first<{ count: number }>())?.count).toBe(0)
  })

  it('strictly validates method, content type, body fields, and session matching', async () => {
    await setup()
    const session = await prepareCompletion()
    const wrongMethod = await runtime!.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/end`,
      { method: 'GET', headers: { Cookie: session.cookie } },
    )
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('Allow')).toBe('POST')

    const nonJson = await runtime!.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/end`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Idempotency-Key': crypto.randomUUID(),
          Cookie: session.cookie,
        },
        body: '{}',
      },
    )
    expect(nonJson.status).toBe(415)

    const unknown = await endSession(session, crypto.randomUUID(), {
      sessionId: session.sessionId,
      clientCompletedAt: at,
      clientSequence: 10,
      completionStatus: 'completed',
    })
    expect(unknown.status).toBe(400)

    const mismatch = await endSession(session, crypto.randomUUID(), {
      sessionId: crypto.randomUUID(),
      clientCompletedAt: at,
      clientSequence: 10,
    })
    expect(mismatch.status).toBe(401)
  })

  it('locks every formal game and questionnaire write after completion', async () => {
    await setup()
    const session = await prepareCompletion()
    expect((await endSession(session)).status).toBe(201)
    const submittedAt = new Date().toISOString()
    const writes: Array<[string, Record<string, unknown>]> = [
      ['/api/questionnaires', {
        sessionId: session.sessionId,
        phase: 'post',
        instrumentVersion: POST_TASK_INSTRUMENT.version,
        clientSubmittedAt: submittedAt,
        answers: answerRows(POST_TASK_INSTRUMENT.items),
      }],
      ['/api/ratings', {
        sessionId: session.sessionId,
        candidateId: 'A',
        stage: 'T1',
        ratingValue: 50,
        clientSubmittedAt: submittedAt,
        clientSequence: 11,
      }],
      ['/api/stage-choices', {
        sessionId: session.sessionId,
        stage: 'T1',
        candidateId: 'B',
        confidence: 50,
        clientSubmittedAt: submittedAt,
        clientSequence: 11,
      }],
      ['/api/evidence/unlock', {
        sessionId: session.sessionId,
        candidateId: 'A',
        level: 'shallow',
        clientAt: submittedAt,
        clientSequence: 11,
      }],
      ['/api/sunk-cost/show', {
        sessionId: session.sessionId,
        clientShownAt: submittedAt,
        clientSequence: 11,
      }],
      ['/api/sunk-cost/choice', {
        sessionId: session.sessionId,
        sunkEventId: crypto.randomUUID(),
        choice: 'continue',
        clientSubmittedAt: submittedAt,
        clientSequence: 11,
      }],
      ['/api/final-decision', {
        sessionId: session.sessionId,
        candidateId: 'B',
        confidence: 50,
        clientSubmittedAt: submittedAt,
        clientSequence: 11,
      }],
      ['/api/final-decision/timeout', {
        sessionId: session.sessionId,
        clientObservedAt: submittedAt,
        clientSequence: 11,
      }],
    ]
    for (const [path, body] of writes) {
      const response = await runtime!.dispatchFetch(`http://localhost${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          Cookie: session.cookie,
        },
        body: JSON.stringify(body),
      })
      expect(response.status, path).toBe(409)
      expect(await response.text(), path).toContain('SESSION_NOT_ACTIVE')
    }
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM completion_records
      WHERE session_id=?`).bind(session.sessionId).first<{ count: number }>())?.count).toBe(1)
  })
})

describe('post-task resume projection', () => {
  it.each(['active', 'timeout'] as const)(
    'resumes an %s final at post_task without exposing answers or assessment output',
    async (mode) => {
      await setup()
      const session = await createSession(mode)
      const response = await resumeSession(session)
      expect(response.status).toBe(200)
      const payload = await response.json() as { data: Record<string, unknown> }
      expect(payload.data).toMatchObject({
        session: { sessionId: session.sessionId, currentStep: 'post_task' },
        postTask: { saved: false },
        taskExperience: { saved: false },
        completion: { completed: false },
      })
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toMatch(
        /"(answers|fullName|studentId|phone|trueAbility|rdi|resilience)"\s*:/i,
      )
    },
  )

  it('resumes task_experience with only the sealed post-task submission summary', async () => {
    await setup()
    const session = await createSession()
    expect((await questionnaire(session, 'post')).status).toBe(201)

    const response = await resumeSession(session)
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Record<string, unknown> }
    expect(payload.data).toMatchObject({
      session: { currentStep: 'task_experience' },
      postTask: {
        saved: true,
        instrumentVersion: POST_TASK_INSTRUMENT.version,
        itemCount: 5,
        sequenceNo: 8,
      },
      taskExperience: { saved: false },
      completion: { completed: false },
    })
    expect(JSON.stringify(payload.data)).not.toContain('answers')
  })

  it('resumes completion_pending without reopening either sealed questionnaire', async () => {
    await setup()
    const session = await prepareCompletion()

    const response = await resumeSession(session)
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Record<string, unknown> }
    expect(payload.data).toMatchObject({
      session: { currentStep: 'completion_pending' },
      postTask: { saved: true, sequenceNo: 8 },
      taskExperience: { saved: true, sequenceNo: 9 },
      completion: { completed: false },
    })
    expect(JSON.stringify(payload.data)).not.toContain('answers')
  })

  it.each([
    ['active', 'completed'],
    ['timeout', 'timeout'],
  ] as const)('resumes a completed %s flow as the same neutral completion state', async (
    mode,
    completionStatus,
  ) => {
    await setup()
    const session = await prepareCompletion(mode)
    expect((await endSession(session)).status).toBe(201)

    const response = await resumeSession(session)
    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Record<string, unknown> }
    expect(payload.data).toMatchObject({
      session: { currentStep: 'completed' },
      postTask: { saved: true },
      taskExperience: { saved: true },
      completion: {
        completed: true,
        completionStatus,
        finalSubmitMode: mode,
        sequenceNo: 10,
      },
    })
    const serialized = JSON.stringify(payload.data)
    expect(serialized).not.toMatch(
      /"(answers|fullName|studentId|phone|trueAbility|rdi|resilience)"\s*:/i,
    )
  })
})
