import { describe, expect, it, vi } from 'vitest'
import {
  startFormalGame,
  submitFormalRating,
  submitFormalStageChoice,
  submitFormalT1Rating,
  submitFormalT1StageChoice,
} from './formalGame'

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'request-1' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const snapshot = {
  currentStage: 'T1', stageStatus: 'T1_ACTIVE', durationSec: 900,
  startedAt: '2026-08-01T00:00:00.000Z',
  deadlineAt: '2026-08-01T00:15:00.000Z',
  serverNow: '2026-08-01T00:01:00.000Z', remainingSec: 840,
  expired: false, points: { total: 5, remaining: 5 },
  ratings: [], stageChoice: null, stageChoices: [], evidenceUnlocks: [],
}

describe('formal game API client', () => {
  it('starts with credentials and the caller idempotency key', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({
      created: true, sessionId: 'session-1', currentStep: 'playing',
      candidateDisplayOrder: ['B', 'A', 'E', 'C', 'D'],
      initialOpenedCandidate: 'B', ...snapshot,
    }, 201))
    const result = await startFormalGame({
      sessionId: 'session-1', clientStartedAt: '2026-08-01T00:00:00.000Z',
      clientVersion: 'stage-4-test',
    }, 'event-start', fetcher)
    expect(result.created).toBe(true)
    expect(fetcher).toHaveBeenCalledWith('/api/sessions/session-1/start', expect.objectContaining({
      method: 'POST', credentials: 'include',
      headers: expect.objectContaining({ 'Idempotency-Key': 'event-start' }),
    }))
  })

  it.each([0, 100])('submits and parses sealed T1 rating %s', async (ratingValue) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({
      created: true, sessionId: 'session-1', candidateId: 'A', stage: 'T1',
      ratingValue, evidenceIdsSeen: [], sealed: true, sequenceNo: 2,
      serverSubmittedAt: '2026-08-01T00:01:00.000Z',
      ratedCandidateCount: 1, requiredCandidateCount: 5, allStageRated: false, allT1Rated: false,
    }, 201))
    const result = await submitFormalT1Rating({
      sessionId: 'session-1', candidateId: 'A', ratingValue,
      clientSubmittedAt: '2026-08-01T00:01:00.000Z', clientSequence: 1,
    }, 'event-rating', fetcher)
    expect(result.ratingValue).toBe(ratingValue)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('evidenceIdsSeen')
  })

  it('submits an actively touched zero-confidence T1 choice', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({
      created: true, sessionId: 'session-1', stage: 'T1', candidateId: 'B',
      confidence: 0, sealed: true, currentStage: 'T1_COMPLETE', stageStatus: 'T1_COMPLETE', sequenceNo: 7,
      serverSubmittedAt: '2026-08-01T00:05:00.000Z',
    }, 201))
    const result = await submitFormalT1StageChoice({
      sessionId: 'session-1', candidateId: 'B', confidence: 0,
      clientSubmittedAt: '2026-08-01T00:05:00.000Z', clientSequence: 6,
    }, 'event-choice', fetcher)
    expect(result).toMatchObject({ confidence: 0, currentStage: 'T1_COMPLETE' })
  })

  it('rejects a malformed successful response instead of fabricating state', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({ created: true }))
    await expect(startFormalGame({
      sessionId: 'session-1', clientStartedAt: '2026-08-01T00:00:00.000Z',
      clientVersion: 'stage-4-test',
    }, 'event-start', fetcher)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('submits a T2 rating without trusting client evidence ids', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({
      created: true, sessionId: 'session-1', candidateId: 'B', stage: 'T2',
      ratingValue: 82, evidenceIdsSeen: ['B-S1', 'B-S2'], sealed: true, sequenceNo: 9,
      serverSubmittedAt: '2026-08-01T00:06:00.000Z', ratedCandidateCount: 1,
      requiredCandidateCount: 1, allStageRated: true, allT1Rated: true,
    }, 201))
    const result = await submitFormalRating({
      sessionId: 'session-1', candidateId: 'B', stage: 'T2', ratingValue: 82,
      clientSubmittedAt: '2026-08-01T00:06:00.000Z', clientSequence: 8,
    }, 'event-t2-rating', fetcher)
    expect(result.evidenceIdsSeen).toEqual(['B-S1', 'B-S2'])
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('evidenceIdsSeen')
  })

  it('submits a T3 stage choice with the generic client', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({
      created: true, sessionId: 'session-1', stage: 'T3', candidateId: 'D',
      confidence: 91, sealed: true, currentStage: 'T3', stageStatus: 'T3_COMPLETE',
      sequenceNo: 14, serverSubmittedAt: '2026-08-01T00:10:00.000Z',
    }, 201))
    const result = await submitFormalStageChoice({
      sessionId: 'session-1', stage: 'T3', candidateId: 'D', confidence: 91,
      clientSubmittedAt: '2026-08-01T00:10:00.000Z', clientSequence: 13,
    }, 'event-t3-choice', fetcher)
    expect(result).toMatchObject({ stage: 'T3', stageStatus: 'T3_COMPLETE' })
  })
})
