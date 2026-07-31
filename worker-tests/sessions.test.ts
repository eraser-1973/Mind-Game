import type { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { hashSessionToken } from '../worker/domain/sessionToken'
import { createWorkerRuntime } from './runtime'

type SessionSuccess = {
  ok: true
  data: {
    created: boolean
    participantId: string
    sessionId: string
    mode: 'formal'
    configSetId: string
    versions: {
      task: string
      material: string
      pointRule: string
      scoring: string
      benchmark: string
      norm: string | null
    }
    candidateDisplayOrder: string[]
    initialOpenedCandidate: string
    currentStep: string
    createdAt: string
  }
  requestId: string
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
  return created
}

function requestHeaders(
  idempotencyKey = crypto.randomUUID(),
  contentType = 'application/json',
) {
  return {
    'Content-Type': contentType,
    'Idempotency-Key': idempotencyKey,
  }
}

function requestBody(
  identity: Record<string, string | null> = { fullName: 'Local Test' },
) {
  return {
    mode: 'formal',
    identity,
    clientVersion: 'test-client',
  }
}

async function postSession(options?: {
  key?: string
  identity?: Record<string, string | null>
  mode?: string
  url?: string
}) {
  if (!runtime) throw new Error('runtime is not initialized')
  return runtime.dispatchFetch(
    options?.url ?? 'http://localhost/api/sessions',
    {
      method: 'POST',
      headers: requestHeaders(options?.key),
      body: JSON.stringify({
        ...requestBody(options?.identity),
        mode: options?.mode ?? 'formal',
      }),
    },
  )
}

async function tableCount(table: string): Promise<number> {
  if (!db) throw new Error('database is not initialized')
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{ count: number }>()
  return row?.count ?? -1
}

function cookieToken(response: {
  headers: { get(name: string): string | null }
}): string {
  const cookie = response.headers.get('Set-Cookie') ?? ''
  return cookie.match(/mg_session=([^;]+)/)?.[1] ?? ''
}

describe('POST /api/sessions validation and creation', () => {
  it('creates a formal session and returns only the safe projection', async () => {
    await setup()
    const response = await postSession({
      identity: {
        fullName: '  Local   Test  ',
        studentId: ' st 001 ',
        phone: '+1 (202) 555-0100',
      },
    })
    const payload = (await response.json()) as SessionSuccess

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      ok: true,
      data: {
        created: true,
        mode: 'formal',
        configSetId: 'config-2026-07-v1',
        versions: {
          task: 'task-1.0.0',
          material: 'material-1.0.0',
          pointRule: 'points-5-v1',
          scoring: 'RDI-2.0-prepilot',
          benchmark: 'benchmark-1.0.0',
          norm: null,
        },
        currentStep: 'demographics',
      },
      requestId: expect.any(String),
    })
    expect(payload.data.participantId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(payload.data.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(payload.data.candidateDisplayOrder.slice().sort()).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ])
    expect(payload.data.initialOpenedCandidate).toBe(
      payload.data.candidateDisplayOrder[0],
    )
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      'Local Test',
      'st 001',
      '+1 (202)',
      'studentIdNormalized',
      'phoneNormalized',
      'tokenHash',
      'duplicateStudentId',
      'database_id',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('writes separated normalized identity, immutable versions, and null timers', async () => {
    await setup()
    const response = await postSession({
      identity: {
        fullName: '  Local   Test  ',
        studentId: ' st 001 ',
        phone: '+1 (202) 555-0100',
      },
    })
    const payload = (await response.json()) as SessionSuccess
    const identity = await db!.prepare(
      'SELECT * FROM participant_identity WHERE participant_id = ?',
    ).bind(payload.data.participantId).first<Record<string, unknown>>()
    const session = await db!.prepare(
      'SELECT * FROM sessions WHERE session_id = ?',
    ).bind(payload.data.sessionId).first<Record<string, unknown>>()

    expect(identity).toMatchObject({
      full_name: 'Local Test',
      student_id: 'st 001',
      student_id_normalized: 'ST001',
      phone: '+1 (202) 555-0100',
      phone_normalized: '+12025550100',
    })
    expect(session).toMatchObject({
      participant_id: payload.data.participantId,
      mode: 'formal',
      config_set_id: 'config-2026-07-v1',
      task_version: 'task-1.0.0',
      material_version: 'material-1.0.0',
      point_rule_version: 'points-5-v1',
      scoring_version: 'RDI-2.0-prepilot',
      benchmark_version: 'benchmark-1.0.0',
      norm_version: null,
      initial_opened_candidate: payload.data.candidateDisplayOrder[0],
      completion_status: 'in_progress',
      current_step: 'demographics',
      final_submit_mode: 'none',
      started_at: null,
      deadline_at: null,
    })
    expect(session).not.toHaveProperty('full_name')
    expect(session).not.toHaveProperty('student_id')
    expect(session).not.toHaveProperty('phone')
  })

  it.each([
    [{ fullName: 'Only Name' }],
    [{ studentId: 'ONLY-001' }],
    [{ phone: '+4930123456' }],
  ])('accepts any one valid identity field: %o', async (identity) => {
    await setup()
    const response = await postSession({ identity })
    expect(response.status).toBe(201)
  })

  it('rejects empty or invalid identity without echoing input', async () => {
    await setup()
    const empty = await postSession({
      identity: { fullName: ' ', studentId: '', phone: '' },
    })
    const invalid = await postSession({ identity: { phone: 'secret-invalid' } })
    const emptyBody = await empty.text()
    const invalidBody = await invalid.text()

    expect(empty.status).toBe(400)
    expect(emptyBody).toContain('IDENTITY_REQUIRED')
    expect(invalid.status).toBe(400)
    expect(invalidBody).toContain('INVALID_IDENTITY')
    expect(invalidBody).not.toContain('secret-invalid')
    expect(await tableCount('participants')).toBe(0)
  })

  it('rejects quick mode, missing or invalid idempotency keys, and GET', async () => {
    await setup()
    const quick = await postSession({ mode: 'quick' })
    const missing = await runtime!.dispatchFetch(
      'http://localhost/api/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody()),
      },
    )
    const invalid = await postSession({ key: 'not-a-uuid' })
    const get = await runtime!.dispatchFetch('http://localhost/api/sessions')

    expect(quick.status).toBe(400)
    expect(await quick.text()).toContain('INVALID_MODE')
    expect(missing.status).toBe(400)
    expect(await missing.text()).toContain('INVALID_IDEMPOTENCY_KEY')
    expect(invalid.status).toBe(400)
    expect(get.status).toBe(405)
    expect(get.headers.get('Allow')).toBe('POST')
    expect(await tableCount('sessions')).toBe(0)
  })

  it('rejects non-JSON and bodies over 16 KiB before database writes', async () => {
    await setup()
    const nonJson = await runtime!.dispatchFetch(
      'http://localhost/api/sessions',
      {
        method: 'POST',
        headers: requestHeaders(crypto.randomUUID(), 'text/plain'),
        body: '{}',
      },
    )
    const oversized = await runtime!.dispatchFetch(
      'http://localhost/api/sessions',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          ...requestBody(),
          padding: 'x'.repeat(17 * 1024),
        }),
      },
    )

    expect(nonJson.status).toBe(415)
    expect(oversized.status).toBe(413)
    expect(await tableCount('participants')).toBe(0)
  })

  it('returns CONFIG_NOT_READY when no published active set exists', async () => {
    await setup()
    await db!.prepare(
      'UPDATE configuration_sets SET is_active = 0',
    ).run()

    const response = await postSession()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toContain('CONFIG_NOT_READY')
    expect(await tableCount('sessions')).toBe(0)
  })

  it('stores only the token hash and applies secure cookie attributes by scheme', async () => {
    await setup()
    const local = await postSession()
    const localPayload = (await local.json()) as SessionSuccess
    const localCookie = local.headers.get('Set-Cookie') ?? ''
    const token = cookieToken(local)
    const credential = await db!.prepare(
      'SELECT token_hash FROM session_credentials WHERE session_id = ?',
    ).bind(localPayload.data.sessionId).first<{ token_hash: string }>()

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(credential?.token_hash).toBe(await hashSessionToken(token))
    expect(credential?.token_hash).not.toBe(token)
    expect(localCookie).toContain('HttpOnly')
    expect(localCookie).toContain('SameSite=Strict')
    expect(localCookie).toContain('Path=/api')
    expect(localCookie).not.toContain('Secure')

    const secure = await postSession({ url: 'https://example.test/api/sessions' })
    expect(secure.headers.get('Set-Cookie')).toContain('Secure')
  })

  it('rolls back all four records and sanitizes a database failure', async () => {
    await setup()
    await db!.prepare('DROP TABLE session_credentials').run()

    const response = await postSession({
      identity: { fullName: 'Do Not Echo This Name' },
    })
    const body = await response.text()

    expect(response.status).toBe(500)
    expect(body).toContain('SESSION_CREATE_FAILED')
    expect(body).toContain('requestId')
    expect(body).not.toContain('Do Not Echo This Name')
    expect(body).not.toMatch(/SQL|no such table|stack|database_id|D:\\/i)
    expect(await tableCount('participants')).toBe(0)
    expect(await tableCount('participant_identity')).toBe(0)
    expect(await tableCount('sessions')).toBe(0)
  })
})

describe('session creation idempotency and duplicate markers', () => {
  it('replays one creation key without duplicate rows and rotates the token hash', async () => {
    await setup()
    const key = crypto.randomUUID()
    const first = await postSession({ key, identity: { studentId: 'IDEM-001' } })
    const firstPayload = (await first.json()) as SessionSuccess
    const firstHash = await db!.prepare(
      'SELECT token_hash FROM session_credentials WHERE session_id = ?',
    ).bind(firstPayload.data.sessionId).first<{ token_hash: string }>()
    const second = await postSession({ key, identity: { studentId: 'IGNORED-002' } })
    const secondPayload = (await second.json()) as SessionSuccess
    const secondHash = await db!.prepare(
      'SELECT token_hash FROM session_credentials WHERE session_id = ?',
    ).bind(firstPayload.data.sessionId).first<{ token_hash: string }>()

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(firstPayload.data.created).toBe(true)
    expect(secondPayload.data.created).toBe(false)
    expect(secondPayload.data.participantId).toBe(firstPayload.data.participantId)
    expect(secondPayload.data.sessionId).toBe(firstPayload.data.sessionId)
    expect(secondPayload.data.candidateDisplayOrder).toEqual(
      firstPayload.data.candidateDisplayOrder,
    )
    expect(secondPayload.data.versions).toEqual(firstPayload.data.versions)
    expect(firstHash?.token_hash).not.toBe(secondHash?.token_hash)
    expect(cookieToken(first)).not.toBe(cookieToken(second))
    expect(await tableCount('participants')).toBe(1)
    expect(await tableCount('participant_identity')).toBe(1)
    expect(await tableCount('sessions')).toBe(1)
    expect(await tableCount('session_credentials')).toBe(1)
  })

  it('handles two concurrent requests for one key without exposing UNIQUE errors', async () => {
    await setup()
    const key = crypto.randomUUID()
    const [left, right] = await Promise.all([
      postSession({ key, identity: { fullName: 'Concurrent Test' } }),
      postSession({ key, identity: { fullName: 'Concurrent Test' } }),
    ])
    const leftBody = (await left.json()) as SessionSuccess
    const rightBody = (await right.json()) as SessionSuccess

    expect([left.status, right.status].sort()).toEqual([200, 201])
    expect(leftBody.data.sessionId).toBe(rightBody.data.sessionId)
    expect(leftBody.data.participantId).toBe(rightBody.data.participantId)
    expect(await tableCount('sessions')).toBe(1)
    expect(JSON.stringify([leftBody, rightBody])).not.toContain('UNIQUE')
  })

  it('marks normalized student/phone matches but still creates a new participant', async () => {
    await setup()
    await postSession({
      identity: {
        fullName: 'First Person',
        studentId: 'dup 001',
        phone: '+49 (30) 123456',
      },
    })
    const second = await postSession({
      identity: {
        fullName: 'Second Person',
        studentId: 'DUP001',
        phone: '+4930-123456',
      },
    })
    const secondPayload = (await second.json()) as SessionSuccess
    const session = await db!.prepare(
      `SELECT duplicate_student_id, duplicate_phone,
              prior_identity_match_count
       FROM sessions WHERE session_id = ?`,
    ).bind(secondPayload.data.sessionId).first<Record<string, number>>()

    expect(second.status).toBe(201)
    expect(await tableCount('participants')).toBe(2)
    expect(session).toEqual({
      duplicate_student_id: 1,
      duplicate_phone: 1,
      prior_identity_match_count: 1,
    })
  })

  it('does not mark matching names alone as duplicate identity', async () => {
    await setup()
    await postSession({ identity: { fullName: 'Same Name' } })
    const second = await postSession({ identity: { fullName: 'Same Name' } })
    const secondPayload = (await second.json()) as SessionSuccess
    const session = await db!.prepare(
      `SELECT duplicate_student_id, duplicate_phone,
              prior_identity_match_count
       FROM sessions WHERE session_id = ?`,
    ).bind(secondPayload.data.sessionId).first<Record<string, number>>()

    expect(session).toEqual({
      duplicate_student_id: 0,
      duplicate_phone: 0,
      prior_identity_match_count: 0,
    })
    expect(await tableCount('participants')).toBe(2)
  })
})
