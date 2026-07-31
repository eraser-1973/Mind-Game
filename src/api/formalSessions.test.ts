import { describe, expect, it, vi } from 'vitest'
import type { CreateFormalSessionRequest } from '../types/game'
import {
  createFormalSession,
  FormalSessionApiError,
  type FetchLike,
} from './formalSessions'

const request: CreateFormalSessionRequest = {
  mode: 'formal',
  identity: { fullName: 'API Test', studentId: '', phone: '' },
  clientVersion: 'test-client',
}

const responseData = {
  created: true,
  participantId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
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
  candidateDisplayOrder: ['B', 'E', 'A', 'D', 'C'],
  initialOpenedCandidate: 'B',
  currentStep: 'consent_pending',
  createdAt: '2026-07-31T00:00:00.000Z',
}

describe('formal session API client', () => {
  it('posts the typed request with credentials and the provided idempotency key', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({ ok: true, data: responseData, requestId: 'request-1' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await createFormalSession(
      request,
      '33333333-3333-4333-8333-333333333333',
      fetchImpl,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/sessions')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': '33333333-3333-4333-8333-333333333333',
      },
    })
    expect(JSON.parse(String(init?.body))).toEqual(request)
    expect(result).toEqual(responseData)
  })

  it.each([
    [400, 'INVALID_IDENTITY', false],
    [409, 'SESSION_CONFLICT', false],
    [413, 'REQUEST_TOO_LARGE', false],
    [415, 'UNSUPPORTED_MEDIA_TYPE', false],
    [503, 'CONFIG_NOT_READY', true],
  ])('maps HTTP %i to a typed public error', async (status, code, retryable) => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code, message: 'Public message' },
          requestId: 'request-error',
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(
      createFormalSession(
        request,
        '33333333-3333-4333-8333-333333333333',
        fetchImpl,
      ),
    ).rejects.toMatchObject({
      status,
      code,
      retryable,
      requestId: 'request-error',
    })
  })

  it('rejects malformed success envelopes instead of trusting the server shape', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ ok: true, data: { created: true } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      createFormalSession(
        request,
        '33333333-3333-4333-8333-333333333333',
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: true })
  })

  it('turns network failures into retryable errors without identity details', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error('network offline')
    })

    try {
      await createFormalSession(
        request,
        '33333333-3333-4333-8333-333333333333',
        fetchImpl,
      )
      throw new Error('request should fail')
    } catch (error) {
      expect(error).toBeInstanceOf(FormalSessionApiError)
      expect(error).toMatchObject({
        status: null,
        code: 'NETWORK_ERROR',
        retryable: true,
      })
      expect(String((error as Error).message)).not.toContain('API Test')
    }
  })
})
