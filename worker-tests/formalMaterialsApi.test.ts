import type { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

async function createSession() {
  const created = await createWorkerRuntime()
  runtime = created.runtime
  const response = await runtime.dispatchFetch('https://example.test/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ mode: 'formal', identity: { fullName: 'Materials Test' }, clientVersion: 'test' }),
  })
  const body = await response.json() as { data: { sessionId: string } }
  return { ...created, sessionId: body.data.sessionId, cookie: response.headers.get('Set-Cookie') ?? '' }
}

describe('GET /api/sessions/:sessionId/materials', () => {
  it('returns pinned public profiles in session display order without evidence or hidden answers', async () => {
    const created = await createSession()
    const response = await created.runtime.dispatchFetch(
      `https://example.test/api/sessions/${created.sessionId}/materials`,
      { headers: { Cookie: created.cookie } },
    )
    const body = await response.json() as { data: { materialVersion: string; candidates: Array<Record<string, unknown>> } }
    const session = await created.db.prepare(
      'SELECT candidate_display_order FROM sessions WHERE session_id = ?',
    ).bind(created.sessionId).first<{ candidate_display_order: string }>()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.data.materialVersion).toBe('material-1.0.0')
    expect(body.data.candidates.map(({ id }) => id)).toEqual(JSON.parse(session!.candidate_display_order))
    expect(body.data.candidates).toHaveLength(5)
    expect(JSON.stringify(body)).not.toMatch(/evidence|polarity|isKeyRisk|trueAbility|trueFit|isToxic|riskFlags|baselineFitScore|dimensionScores/i)
  })

  it('rejects a mismatched cookie session and returns MATERIAL_NOT_READY for missing pinned material', async () => {
    const first = await createSession()
    const secondResponse = await first.runtime.dispatchFetch('https://example.test/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ mode: 'formal', identity: { fullName: 'Other Test' }, clientVersion: 'test' }),
    })
    const second = await secondResponse.json() as { data: { sessionId: string } }
    const mismatch = await first.runtime.dispatchFetch(
      `https://example.test/api/sessions/${second.data.sessionId}/materials`,
      { headers: { Cookie: first.cookie } },
    )
    expect(mismatch.status).toBe(401)

    await first.db.prepare('DROP TRIGGER material_sets_published_no_update').run()
    await first.db.prepare("UPDATE sessions SET material_version='missing-version' WHERE session_id=?")
      .bind(first.sessionId).run()
    const missing = await first.runtime.dispatchFetch(
      `https://example.test/api/sessions/${first.sessionId}/materials`,
      { headers: { Cookie: first.cookie } },
    )
    const body = await missing.json() as { error: { code: string } }
    expect(missing.status).toBe(409)
    expect(body.error.code).toBe('MATERIAL_NOT_READY')
  })
})
