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

async function createSession(): Promise<TestSession> {
  const response = await runtime!.dispatchFetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      mode: 'formal',
      identity: { fullName: 'Stage7 Questionnaire Synthetic' },
      clientVersion: 'stage7-test',
    }),
  })
  expect(response.status).toBe(201)
  const payload = await response.json() as {
    data: { sessionId: string; participantId: string }
  }
  return {
    ...payload.data,
    cookie: (response.headers.get('Set-Cookie') ?? '').split(';')[0],
  }
}

async function finalizeSession(
  session: TestSession,
  mode: 'active' | 'timeout' = 'active',
) {
  const at = '2026-08-01T01:00:00.000Z'
  const status = mode === 'active' ? 'in_progress' : 'timeout'
  await db!.batch([
    db!.prepare(`UPDATE sessions SET current_step='post_task',completion_status=?,
      final_submit_mode=?,started_at='2026-08-01T00:45:00.000Z',
      deadline_at='2026-08-01T01:00:00.000Z' WHERE session_id=?`)
      .bind(status, mode, session.sessionId),
    db!.prepare(`INSERT INTO game_runs (
      session_id,start_event_id,current_stage,duration_sec,points_total,points_remaining,
      last_sequence_no,started_at,deadline_at,time_expired_at,t1_completed_at,
      updated_at,finalized_at
    ) VALUES (?,?,'DECISION',900,5,5,7,'2026-08-01T00:45:00.000Z',
      '2026-08-01T01:00:00.000Z',?,?,?,?)`)
      .bind(session.sessionId, crypto.randomUUID(),
        mode === 'timeout' ? at : null, '2026-08-01T00:50:00.000Z', at, at),
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
}

const timestamp = '2026-08-01T01:01:00.000Z'

function instrumentAnswers(
  items: readonly { id: string; min: number; max: number }[],
  choose: (item: { id: string; min: number; max: number }) => number = (item) => item.min,
) {
  return items.map((item) => ({
    itemId: item.id,
    value: choose(item),
    touched: true,
    answeredAt: timestamp,
  }))
}

function postBody(sessionId: string) {
  return {
    sessionId,
    phase: 'post',
    instrumentVersion: POST_TASK_INSTRUMENT.version,
    clientSubmittedAt: timestamp,
    answers: instrumentAnswers(POST_TASK_INSTRUMENT.items),
  }
}

function taskBody(sessionId: string) {
  return {
    sessionId,
    phase: 'task_experience',
    instrumentVersion: TASK_EXPERIENCE_INSTRUMENT.version,
    clientSubmittedAt: timestamp,
    answers: instrumentAnswers(TASK_EXPERIENCE_INSTRUMENT.items, (item) =>
      item.id === 'decisionConfidence' ? 0 : 1),
  }
}

function postQuestionnaire(
  session: TestSession,
  body: unknown,
  key = crypto.randomUUID(),
) {
  return runtime!.dispatchFetch('http://localhost/api/questionnaires', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Cookie: session.cookie,
    },
    body: JSON.stringify(body),
  })
}

describe('Stage 7 post-task questionnaire persistence', () => {
  it.each(['active', 'timeout'] as const)(
    'atomically saves five post answers and advances an %s final session',
    async (mode) => {
      await setup()
      const session = await createSession()
      await finalizeSession(session, mode)

      const response = await postQuestionnaire(session, postBody(session.sessionId))
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({
        ok: true,
        data: {
          created: true,
          sessionId: session.sessionId,
          currentStep: 'task_experience',
          itemCount: 5,
          sequenceNo: 8,
        },
      })

      const stored = await db!.prepare(`SELECT s.current_step,s.completion_status,
        s.post_task_completed_at,q.sequence_no,q.instrument_version
        FROM sessions s JOIN questionnaire_submissions q ON q.session_id=s.session_id
        WHERE s.session_id=? AND q.phase='post'`).bind(session.sessionId)
        .first<Record<string, unknown>>()
      const answers = await db!.prepare(`SELECT COUNT(*) AS count FROM questionnaire_answers a
        JOIN questionnaire_submissions q ON q.submission_id=a.submission_id
        WHERE q.session_id=? AND q.phase='post' AND a.touched=1`).bind(session.sessionId)
        .first<{ count: number }>()
      const event = await db!.prepare(`SELECT event_type,server_sequence,payload_json
        FROM game_events WHERE session_id=? AND event_type='post_task_submit'`)
        .bind(session.sessionId).first<Record<string, unknown>>()

      expect(stored).toMatchObject({
        current_step: 'task_experience',
        completion_status: mode === 'active' ? 'in_progress' : 'timeout',
        sequence_no: 8,
        instrument_version: 'state-assessment-post-1.0.0',
        post_task_completed_at: expect.any(String),
      })
      expect(answers?.count).toBe(5)
      expect(event).toMatchObject({ event_type: 'post_task_submit', server_sequence: 8 })
      expect(JSON.parse(String(event?.payload_json))).toEqual({
        phase: 'post',
        instrumentVersion: 'state-assessment-post-1.0.0',
        itemCount: 5,
      })
    },
  )

  it('requires a sealed final decision and the post_task step', async () => {
    await setup()
    const noFinal = await createSession()
    await db!.prepare("UPDATE sessions SET current_step='post_task' WHERE session_id=?")
      .bind(noFinal.sessionId).run()
    expect((await postQuestionnaire(noFinal, postBody(noFinal.sessionId))).status).toBe(409)

    const wrongStep = await createSession()
    await finalizeSession(wrongStep)
    await db!.prepare("UPDATE sessions SET current_step='playing' WHERE session_id=?")
      .bind(wrongStep.sessionId).run()
    expect((await postQuestionnaire(wrongStep, postBody(wrongStep.sessionId))).status).toBe(409)
  })

  it('replays the same key without another row or sequence and seals against another key', async () => {
    await setup()
    const session = await createSession()
    await finalizeSession(session)
    const key = crypto.randomUUID()
    expect((await postQuestionnaire(session, postBody(session.sessionId), key)).status).toBe(201)
    const replay = await postQuestionnaire(session, postBody(session.sessionId), key)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ data: { created: false, sequenceNo: 8 } })
    const overwrite = await postQuestionnaire(session, postBody(session.sessionId))
    expect(overwrite.status).toBe(409)
    expect(await overwrite.json()).toMatchObject({
      error: { code: 'QUESTIONNAIRE_ALREADY_SUBMITTED' },
    })
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM questionnaire_submissions
      WHERE session_id=? AND phase='post'`).bind(session.sessionId)
      .first<{ count: number }>())?.count).toBe(1)
    expect((await db!.prepare('SELECT last_sequence_no FROM game_runs WHERE session_id=?')
      .bind(session.sessionId).first<{ last_sequence_no: number }>())?.last_sequence_no).toBe(8)
  })

  it('converges concurrent post requests on one sealed submission', async () => {
    await setup()
    const session = await createSession()
    await finalizeSession(session)
    const responses = await Promise.all([
      postQuestionnaire(session, postBody(session.sessionId)),
      postQuestionnaire(session, postBody(session.sessionId)),
    ])
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409])
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM questionnaire_submissions
      WHERE session_id=? AND phase='post'`).bind(session.sessionId)
      .first<{ count: number }>())?.count).toBe(1)
  })
})

describe('Stage 7 task-experience questionnaire persistence', () => {
  it('saves all fifteen touched answers, preserves confidence zero, and advances sequence', async () => {
    await setup()
    const session = await createSession()
    await finalizeSession(session)
    expect((await postQuestionnaire(session, postBody(session.sessionId))).status).toBe(201)

    const response = await postQuestionnaire(session, taskBody(session.sessionId))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      data: {
        created: true,
        currentStep: 'completion_pending',
        itemCount: 15,
        sequenceNo: 9,
      },
    })
    const saved = await db!.prepare(`SELECT a.value,q.sequence_no,s.current_step,
      s.task_experience_completed_at FROM questionnaire_answers a
      JOIN questionnaire_submissions q ON q.submission_id=a.submission_id
      JOIN sessions s ON s.session_id=q.session_id
      WHERE q.session_id=? AND q.phase='task_experience'
        AND a.item_id='decisionConfidence'`).bind(session.sessionId)
      .first<Record<string, unknown>>()
    expect(saved).toMatchObject({
      value: 0,
      sequence_no: 9,
      current_step: 'completion_pending',
      task_experience_completed_at: expect.any(String),
    })
    expect((await db!.prepare(`SELECT COUNT(*) AS count FROM questionnaire_answers a
      JOIN questionnaire_submissions q ON q.submission_id=a.submission_id
      WHERE q.session_id=? AND q.phase='task_experience' AND a.touched=1`)
      .bind(session.sessionId).first<{ count: number }>())?.count).toBe(15)
    expect((await db!.prepare(`SELECT server_sequence FROM game_events
      WHERE session_id=? AND event_type='task_experience_submit'`)
      .bind(session.sessionId).first<{ server_sequence: number }>())?.server_sequence).toBe(9)
  })

  it('requires the post submission and seals task-experience idempotently', async () => {
    await setup()
    const session = await createSession()
    await finalizeSession(session)
    expect((await postQuestionnaire(session, taskBody(session.sessionId))).status).toBe(409)

    expect((await postQuestionnaire(session, postBody(session.sessionId))).status).toBe(201)
    const key = crypto.randomUUID()
    expect((await postQuestionnaire(session, taskBody(session.sessionId), key)).status).toBe(201)
    const replay = await postQuestionnaire(session, taskBody(session.sessionId), key)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ data: { created: false, sequenceNo: 9 } })
    const overwrite = await postQuestionnaire(session, taskBody(session.sessionId))
    expect(overwrite.status).toBe(409)
    expect(await overwrite.json()).toMatchObject({
      error: { code: 'QUESTIONNAIRE_ALREADY_SUBMITTED' },
    })
  })
})
