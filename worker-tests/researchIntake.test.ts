import type { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkerRuntime } from './runtime'

type CreatedSession = {
  sessionId: string
  participantId: string
  cookie: string
}

let runtime: Miniflare | undefined
let db: Awaited<ReturnType<typeof createWorkerRuntime>>['db'] | undefined

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

async function createSession(label = 'Research Intake Test'): Promise<CreatedSession> {
  const response = await runtime!.dispatchFetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      mode: 'formal',
      identity: { fullName: label },
      clientVersion: 'stage-3-test',
    }),
  })
  const payload = await response.json() as {
    data: { sessionId: string; participantId: string }
  }
  const setCookie = response.headers.get('Set-Cookie') ?? ''
  return {
    ...payload.data,
    cookie: setCookie.split(';')[0],
  }
}

function validConsent(sessionId: string) {
  return {
    sessionId,
    accepted: true,
    consentVersion: 'consent-1.0.0',
    clientAcceptedAt: '2026-08-01T00:00:00.000Z',
  }
}

function validDemographics(sessionId: string) {
  return {
    sessionId,
    demographics: {
      ageRange: '21–23',
      gender: '不愿透露',
      education: '本科',
      grade: '大三',
      majorCategory: '计算机或人工智能',
      relatedExperience: ['企业实习经历', '数据分析相关经历'],
    },
    clientSubmittedAt: '2026-08-01T00:01:00.000Z',
  }
}

function validQuestionnaire(sessionId: string) {
  const ids = [
    'stress',
    'fatigue',
    'attention',
    'mood',
    'physicalDiscomfort',
  ]
  return {
    sessionId,
    phase: 'pre',
    instrumentVersion: 'state-assessment-pre-1.0.0',
    clientStartedAt: '2026-08-01T00:02:00.000Z',
    clientSubmittedAt: '2026-08-01T00:03:00.000Z',
    answers: ids.map((itemId, index) => ({
      itemId,
      value: index,
      touched: true,
      answeredAt: `2026-08-01T00:02:0${index}.000Z`,
    })),
  }
}

async function post(
  path: string,
  body: unknown,
  cookie: string,
  key = crypto.randomUUID(),
  extraHeaders?: Record<string, string>,
) {
  return runtime!.dispatchFetch(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      Cookie: cookie,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

async function acceptConsent(session: CreatedSession, key = crypto.randomUUID()) {
  return post('/api/consent', validConsent(session.sessionId), session.cookie, key)
}

async function saveDemographics(session: CreatedSession, key = crypto.randomUUID()) {
  return post('/api/demographics', validDemographics(session.sessionId), session.cookie, key)
}

describe('Stage 3 authenticated intake happy path and resume', () => {
  it('persists consent, demographics, five touched pre-task answers, and reaches game_ready', async () => {
    await setup()
    const session = await createSession()

    const consent = await acceptConsent(session)
    expect(consent.status).toBe(201)
    expect(await consent.json()).toMatchObject({
      ok: true,
      data: { created: true, sessionId: session.sessionId, currentStep: 'demographics' },
      requestId: expect.any(String),
    })

    const demographics = await saveDemographics(session)
    expect(demographics.status).toBe(201)
    expect(await demographics.json()).toMatchObject({
      ok: true,
      data: { created: true, revisionNo: 1, currentStep: 'pre_task' },
    })

    const questionnaire = await post(
      '/api/questionnaires',
      validQuestionnaire(session.sessionId),
      session.cookie,
    )
    expect(questionnaire.status).toBe(201)
    expect(await questionnaire.json()).toMatchObject({
      ok: true,
      data: { created: true, itemCount: 5, currentStep: 'game_ready' },
    })

    const stored = await db!.prepare(
      'SELECT current_step, started_at, deadline_at FROM sessions WHERE session_id = ?',
    ).bind(session.sessionId).first<Record<string, unknown>>()
    expect(stored).toEqual({
      current_step: 'game_ready',
      started_at: null,
      deadline_at: null,
    })
    const answerCount = await db!.prepare(
      `SELECT COUNT(*) AS count FROM questionnaire_answers qa
       JOIN questionnaire_submissions qs ON qs.submission_id = qa.submission_id
       WHERE qs.session_id = ? AND qa.touched = 1`,
    ).bind(session.sessionId).first<{ count: number }>()
    expect(answerCount?.count).toBe(5)
  })

  it('resumes each pre-game step without rotating cookies or exposing identity and backend markers', async () => {
    await setup()
    const session = await createSession('Secret Resume Name')
    const before = await runtime!.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    expect(before.status).toBe(200)
    expect(before.headers.get('Set-Cookie')).toBeNull()
    expect(await before.json()).toMatchObject({
      ok: true,
      data: {
        session: { sessionId: session.sessionId, currentStep: 'consent_pending' },
        consent: null,
        demographics: null,
        preTask: null,
        game: { startedAt: null, deadlineAt: null, resumeSupported: false },
      },
    })

    await acceptConsent(session)
    await saveDemographics(session)
    const after = await runtime!.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    const text = await after.text()
    expect(after.status).toBe(200)
    expect(text).toContain('pre_task')
    expect(text).toContain('计算机或人工智能')
    for (const forbidden of [
      'Secret Resume Name', 'full_name', 'student_id', 'phone',
      'token_hash', 'duplicate_student_id', 'isToxic', 'trueAbility', 'riskFlags',
    ]) expect(text).not.toContain(forbidden)
  })

  it('rejects an inconsistent playing session without a game run and does not mutate it', async () => {
    await setup()
    const session = await createSession()
    await db!.prepare(
      "UPDATE sessions SET current_step = 'playing', started_at = ? WHERE session_id = ?",
    ).bind('2026-08-01T00:05:00.000Z', session.sessionId).run()

    const response = await runtime!.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    const text = await response.text()
    expect(response.status).toBe(409)
    expect(text).toContain('SESSION_DATA_INTEGRITY_ERROR')
    expect(text).not.toContain('Secret')
    const row = await db!.prepare(
      'SELECT current_step, started_at FROM sessions WHERE session_id = ?',
    ).bind(session.sessionId).first()
    expect(row).toEqual({
      current_step: 'playing',
      started_at: '2026-08-01T00:05:00.000Z',
    })
  })

  it('rejects an internally inconsistent pre-game state instead of resuming with fabricated data', async () => {
    await setup()
    const session = await createSession()
    await db!.prepare(
      "UPDATE sessions SET current_step = 'game_ready' WHERE session_id = ?",
    ).bind(session.sessionId).run()

    const response = await runtime!.dispatchFetch(
      `http://localhost/api/sessions/${session.sessionId}/resume`,
      { headers: { Cookie: session.cookie } },
    )
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('SESSION_DATA_INTEGRITY_ERROR')
  })
})

describe('session cookie authorization', () => {
  it.each([
    ['', 'SESSION_UNAUTHORIZED'],
    ['mg_session=not-a-token', 'SESSION_UNAUTHORIZED'],
  ])('rejects a missing or malformed cookie without existence leakage', async (cookie, code) => {
    await setup()
    const session = await createSession()
    const response = await post('/api/consent', validConsent(session.sessionId), cookie)
    const text = await response.text()
    expect(response.status).toBe(401)
    expect(text).toContain(code)
    expect(text).not.toContain(session.sessionId)
  })

  it('rejects a cookie/body session mismatch as unauthorized', async () => {
    await setup()
    const first = await createSession('First')
    const second = await createSession('Second')
    const response = await post('/api/consent', validConsent(second.sessionId), first.cookie)
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('SESSION_UNAUTHORIZED')
  })

  it('distinguishes revoked credentials and inactive completed sessions safely', async () => {
    await setup()
    const revoked = await createSession('Revoked')
    await db!.prepare(
      'UPDATE session_credentials SET revoked_at = ? WHERE session_id = ?',
    ).bind('2026-08-01T00:00:00.000Z', revoked.sessionId).run()
    const revokedResponse = await post(
      '/api/consent', validConsent(revoked.sessionId), revoked.cookie,
    )
    expect(revokedResponse.status).toBe(401)
    expect(await revokedResponse.text()).toContain('SESSION_REVOKED')

    const completed = await createSession('Completed')
    await db!.prepare(
      "UPDATE sessions SET completion_status = 'completed' WHERE session_id = ?",
    ).bind(completed.sessionId).run()
    const completeResponse = await post(
      '/api/consent', validConsent(completed.sessionId), completed.cookie,
    )
    expect(completeResponse.status).toBe(409)
    expect(await completeResponse.text()).toContain('SESSION_NOT_ACTIVE')
  })
})

describe('consent validation and idempotency', () => {
  it('replays one event id without a duplicate record or step transition', async () => {
    await setup()
    const session = await createSession()
    const key = crypto.randomUUID()
    const first = await acceptConsent(session, key)
    const second = await acceptConsent(session, key)
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ data: { created: false } })
    const count = await db!.prepare(
      'SELECT COUNT(*) AS count FROM consent_records WHERE session_id = ?',
    ).bind(session.sessionId).first<{ count: number }>()
    expect(count?.count).toBe(1)
  })

  it('returns the existing same-version consent for a new idempotency key', async () => {
    await setup()
    const session = await createSession()

    const first = await acceptConsent(session)
    const second = await acceptConsent(session)

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({
      data: {
        created: false,
        sessionId: session.sessionId,
        currentStep: 'demographics',
        consent: {
          accepted: true,
          version: 'consent-1.0.0',
        },
      },
    })
    const count = await db!.prepare(
      'SELECT COUNT(*) AS count FROM consent_records WHERE session_id = ?',
    ).bind(session.sessionId).first<{ count: number }>()
    expect(count?.count).toBe(1)
  })

  it.each([
    [{ accepted: false }, 'CONSENT_REQUIRED'],
    [{ consentVersion: 'old-version' }, 'INVALID_CONSENT_VERSION'],
    [{ clientAcceptedAt: 'not-a-date' }, 'INVALID_TIMESTAMP'],
    [{ unexpected: true }, 'INVALID_REQUEST'],
  ])('rejects invalid consent input without a database write', async (override, code) => {
    await setup()
    const session = await createSession()
    const response = await post(
      '/api/consent',
      { ...validConsent(session.sessionId), ...override },
      session.cookie,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(code)
    const count = await db!.prepare(
      'SELECT COUNT(*) AS count FROM consent_records',
    ).first<{ count: number }>()
    expect(count?.count).toBe(0)
  })

  it('rejects a wrong step and does not return internal database errors', async () => {
    await setup()
    const session = await createSession()
    await db!.prepare(
      "UPDATE sessions SET current_step = 'pre_task' WHERE session_id = ?",
    ).bind(session.sessionId).run()
    const response = await acceptConsent(session)
    const text = await response.text()
    expect(response.status).toBe(409)
    expect(text).toContain('INVALID_SESSION_STEP')
    expect(text).not.toMatch(/SQL|stack|D1_ERROR|database_id/i)
  })
})

describe('demographic revisions and validation', () => {
  it('creates and atomically replaces the current revision while staying at pre_task', async () => {
    await setup()
    const session = await createSession()
    await acceptConsent(session)
    const first = await saveDemographics(session)
    const secondBody = validDemographics(session.sessionId)
    secondBody.demographics.grade = '大四'
    const second = await post('/api/demographics', secondBody, session.cookie)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await second.json()).toMatchObject({
      data: { revisionNo: 2, currentStep: 'pre_task' },
    })
    const rows = await db!.prepare(
      `SELECT revision_no, is_current, grade FROM demographic_revisions
       WHERE session_id = ? ORDER BY revision_no`,
    ).bind(session.sessionId).all<Record<string, unknown>>()
    expect(rows.results).toEqual([
      { revision_no: 1, is_current: 0, grade: '大三' },
      { revision_no: 2, is_current: 1, grade: '大四' },
    ])
  })

  it('replays one event without adding a revision', async () => {
    await setup()
    const session = await createSession()
    await acceptConsent(session)
    const key = crypto.randomUUID()
    await saveDemographics(session, key)
    const replay = await saveDemographics(session, key)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ data: { created: false, revisionNo: 1 } })
  })

  it.each([
    [{ ageRange: '17' }, 'INVALID_DEMOGRAPHICS'],
    [{ relatedExperience: [] }, 'INVALID_DEMOGRAPHICS'],
    [{ relatedExperience: ['无相关经历', '企业实习经历'] }, 'INVALID_DEMOGRAPHICS'],
    [{ relatedExperience: ['企业实习经历', '企业实习经历'] }, 'INVALID_DEMOGRAPHICS'],
    [{ fullName: 'Must not enter research payload' }, 'INVALID_REQUEST'],
  ])('rejects invalid or identifiable demographic data', async (override, code) => {
    await setup()
    const session = await createSession()
    await acceptConsent(session)
    const base = validDemographics(session.sessionId)
    const response = await post(
      '/api/demographics',
      { ...base, demographics: { ...base.demographics, ...override } },
      session.cookie,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(code)
  })

  it('rejects new demographic revisions after game_ready', async () => {
    await setup()
    const session = await createSession()
    await acceptConsent(session)
    await saveDemographics(session)
    await db!.prepare(
      "UPDATE sessions SET current_step = 'game_ready' WHERE session_id = ?",
    ).bind(session.sessionId).run()
    const response = await saveDemographics(session)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('INVALID_SESSION_STEP')
  })
})

describe('pre-task questionnaire integrity and idempotency', () => {
  it('replays one event but rejects a second event from overwriting the pre-task submission', async () => {
    await setup()
    const session = await createSession()
    await acceptConsent(session)
    await saveDemographics(session)
    const key = crypto.randomUUID()
    const first = await post('/api/questionnaires', validQuestionnaire(session.sessionId), session.cookie, key)
    const replay = await post('/api/questionnaires', validQuestionnaire(session.sessionId), session.cookie, key)
    const overwrite = await post('/api/questionnaires', validQuestionnaire(session.sessionId), session.cookie)
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ data: { created: false } })
    expect(overwrite.status).toBe(409)
    expect(await overwrite.text()).toContain('QUESTIONNAIRE_ALREADY_SUBMITTED')
  })

  it.each([
    [{ phase: 'post' }, 'INVALID_QUESTIONNAIRE'],
    [{ instrumentVersion: 'other' }, 'INVALID_QUESTIONNAIRE'],
    [{ answers: [] }, 'INVALID_QUESTIONNAIRE'],
    [{ answers: validQuestionnaire('x').answers.slice(0, 4) }, 'INVALID_QUESTIONNAIRE'],
    [{ answers: validQuestionnaire('x').answers.map((item) => ({ ...item, touched: false })) }, 'QUESTIONNAIRE_INCOMPLETE'],
    [{ answers: validQuestionnaire('x').answers.map((item, index) => ({ ...item, value: index === 0 ? 11 : item.value })) }, 'INVALID_QUESTIONNAIRE'],
    [{ answers: validQuestionnaire('x').answers.map((item, index) => ({ ...item, itemId: index === 4 ? 'stress' : item.itemId })) }, 'INVALID_QUESTIONNAIRE'],
  ])('rejects an incomplete or invalid pre-task instrument', async (override, code) => {
    await setup()
    const session = await createSession()
    await acceptConsent(session)
    await saveDemographics(session)
    const response = await post(
      '/api/questionnaires',
      { ...validQuestionnaire(session.sessionId), ...override },
      session.cookie,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(code)
    const count = await db!.prepare(
      'SELECT COUNT(*) AS count FROM questionnaire_submissions',
    ).first<{ count: number }>()
    expect(count?.count).toBe(0)
  })
})

describe('shared intake request guards', () => {
  it('rejects missing/invalid idempotency keys, non-JSON, oversized bodies, and non-POST methods', async () => {
    await setup()
    const session = await createSession()
    const missing = await runtime!.dispatchFetch('http://localhost/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
      body: JSON.stringify(validConsent(session.sessionId)),
    })
    const invalid = await post(
      '/api/consent', validConsent(session.sessionId), session.cookie, 'not-a-uuid',
    )
    const nonJson = await runtime!.dispatchFetch('http://localhost/api/consent', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Idempotency-Key': crypto.randomUUID(),
        Cookie: session.cookie,
      },
      body: '{}',
    })
    const oversized = await post(
      '/api/consent',
      { ...validConsent(session.sessionId), padding: 'x'.repeat(17 * 1024) },
      session.cookie,
    )
    const get = await runtime!.dispatchFetch('http://localhost/api/consent')

    expect(missing.status).toBe(400)
    expect(invalid.status).toBe(400)
    expect(nonJson.status).toBe(415)
    expect(oversized.status).toBe(413)
    expect(get.status).toBe(405)
    expect(get.headers.get('Allow')).toBe('POST')
  })
})
