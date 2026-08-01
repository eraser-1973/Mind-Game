import { describe, expect, it, vi } from 'vitest'
import type { DemographicData, StateAssessmentData } from '../types/game'
import {
  resumeFormalSession,
  saveFormalConsent,
  saveFormalDemographics,
  saveFormalPreTaskQuestionnaire,
  type FetchLike,
} from './formalResearch'

const sessionId = '22222222-2222-4222-8222-222222222222'
const key = '33333333-3333-4333-8333-333333333333'
const demographics: DemographicData = {
  ageRange: '21–23',
  gender: '不愿透露',
  education: '本科',
  grade: '大三',
  majorCategory: '计算机或人工智能',
  relatedExperience: ['数据分析相关经历'],
}
const preTask: StateAssessmentData = {
  stress: 0,
  fatigue: 1,
  attention: 2,
  mood: 3,
  physicalDiscomfort: 4,
}

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'request-1' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('formal research API client', () => {
  it('submits consent with credentials and a stable idempotency key', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({
      created: true,
      sessionId,
      currentStep: 'demographics',
      consent: { accepted: true, version: 'consent-1.0.0', acceptedAt: '2026-08-01T00:00:00.000Z' },
    }, 201))
    await saveFormalConsent({
      sessionId,
      accepted: true,
      consentVersion: 'consent-1.0.0',
      clientAcceptedAt: '2026-08-01T00:00:00.000Z',
    }, key, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('/api/consent', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'Idempotency-Key': key }),
    }))
  })

  it('submits demographics without storing or adding identity fields', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({
      created: true,
      sessionId,
      currentStep: 'pre_task',
      revisionNo: 1,
      demographics,
      submittedAt: '2026-08-01T00:01:00.000Z',
    }, 201))
    await saveFormalDemographics({
      sessionId,
      demographics,
      clientSubmittedAt: '2026-08-01T00:01:00.000Z',
    }, key, fetchImpl)
    const body = String(fetchImpl.mock.calls[0][1]?.body)
    expect(body).toContain('relatedExperience')
    expect(body).not.toMatch(/fullName|studentId|phone|identity/i)
  })

  it('submits exactly five explicitly touched pre-task items', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({
      created: true,
      sessionId,
      currentStep: 'game_ready',
      submissionId: '44444444-4444-4444-8444-444444444444',
      itemCount: 5,
    }, 201))
    await saveFormalPreTaskQuestionnaire({
      sessionId,
      values: preTask,
      clientStartedAt: '2026-08-01T00:02:00.000Z',
      clientSubmittedAt: '2026-08-01T00:03:00.000Z',
    }, key, fetchImpl)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.phase).toBe('pre')
    expect(body.instrumentVersion).toBe('state-assessment-pre-1.0.0')
    expect(body.answers).toHaveLength(5)
    expect(body.answers.every((answer: { touched: boolean }) => answer.touched)).toBe(true)
    expect(body.answers.find((answer: { itemId: string }) => answer.itemId === 'stress').value).toBe(0)
  })

  it('loads the authenticated safe resume projection without a write key', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({
      session: {
        participantId: '11111111-1111-4111-8111-111111111111',
        sessionId,
        mode: 'formal',
        configSetId: 'config-2026-07-v1',
        versions: {
          task: 'task-1.0.0', material: 'material-1.0.0', pointRule: 'points-5-v1', sunkCostRule: 'sunk-1.0.0',
          scoring: 'RDI-2.0-prepilot', benchmark: 'benchmark-1.0.0', norm: null,
        },
        candidateDisplayOrder: ['B', 'E', 'A', 'D', 'C'],
        initialOpenedCandidate: 'B',
        currentStep: 'pre_task',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      consent: { accepted: true, version: 'consent-1.0.0', acceptedAt: '2026-08-01T00:00:00.000Z' },
      demographics: { revisionNo: 1, demographics, submittedAt: '2026-08-01T00:01:00.000Z' },
      preTask: null,
      game: { startedAt: null, deadlineAt: null, resumeSupported: false },
    }))
    const result = await resumeFormalSession(sessionId, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/sessions/${sessionId}/resume`,
      { method: 'GET', credentials: 'include' },
    )
    expect(result.session.currentStep).toBe('pre_task')
  })

  it('maps network and unauthorized responses to typed public errors', async () => {
    const offline = vi.fn<FetchLike>(async () => { throw new Error('offline') })
    await expect(resumeFormalSession(sessionId, offline)).rejects.toMatchObject({
      status: null,
      code: 'NETWORK_ERROR',
      retryable: true,
    })
    const unauthorized = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'SESSION_UNAUTHORIZED', message: 'Expired.' },
      requestId: 'request-auth',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    await expect(resumeFormalSession(sessionId, unauthorized)).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_UNAUTHORIZED',
      retryable: false,
      requestId: 'request-auth',
    })
  })
})
