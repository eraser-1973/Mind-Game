import { describe, expect, it } from 'vitest'
import {
  POST_TASK_INSTRUMENT,
  TASK_EXPERIENCE_INSTRUMENT,
} from '../worker/domain/questionnaireInstruments'
import { parseQuestionnaireRequest } from '../worker/validation/researchIntakeRequest'

const sessionId = '11111111-1111-4111-8111-111111111111'
const key = '22222222-2222-4222-8222-222222222222'
const timestamp = '2026-08-01T01:00:00.000Z'

function request(body: unknown, contentType = 'application/json', eventId = key) {
  return new Request('http://localhost/api/questionnaires', {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Idempotency-Key': eventId,
    },
    body: JSON.stringify(body),
  })
}

function answers(
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

function postBody() {
  return {
    sessionId,
    phase: 'post',
    instrumentVersion: POST_TASK_INSTRUMENT.version,
    clientSubmittedAt: timestamp,
    answers: answers(POST_TASK_INSTRUMENT.items),
  }
}

function taskBody() {
  return {
    sessionId,
    phase: 'task_experience',
    instrumentVersion: TASK_EXPERIENCE_INSTRUMENT.version,
    clientSubmittedAt: timestamp,
    answers: answers(TASK_EXPERIENCE_INSTRUMENT.items),
  }
}

describe('Stage 7 questionnaire instrument validation', () => {
  it('parses the exact five-item post-task instrument including active zero', async () => {
    const body = postBody()
    body.answers = answers(POST_TASK_INSTRUMENT.items, () => 0)
    await expect(parseQuestionnaireRequest(request(body))).resolves.toMatchObject({
      eventId: key,
      sessionId,
      phase: 'post',
      instrumentVersion: 'state-assessment-post-1.0.0',
      answers: expect.arrayContaining([
        expect.objectContaining({ itemId: 'stress', value: 0, touched: true }),
      ]),
    })
  })

  it('parses 14 one-to-ten items and an independent zero-to-ten confidence item', async () => {
    const body = taskBody()
    body.answers = answers(TASK_EXPERIENCE_INSTRUMENT.items, (item) =>
      item.id === 'decisionConfidence' ? 0 : 1)
    const parsed = await parseQuestionnaireRequest(request(body))
    expect(parsed).toMatchObject({
      phase: 'task_experience',
      instrumentVersion: 'task-experience-1.0.0',
    })
    expect(parsed.answers).toHaveLength(15)
    expect(parsed.answers.find(({ itemId }) => itemId === 'decisionConfidence')?.value).toBe(0)
  })

  it.each([
    ['missing item', (body: ReturnType<typeof postBody>) => { body.answers.pop() }],
    ['duplicate item', (body: ReturnType<typeof postBody>) => { body.answers[4] = body.answers[0] }],
    ['unknown item', (body: ReturnType<typeof postBody>) => { body.answers[0].itemId = 'unknown' }],
    ['untouched item', (body: ReturnType<typeof postBody>) => {
      ;(body.answers[0] as { touched: boolean }).touched = false
    }],
    ['non-integer', (body: ReturnType<typeof postBody>) => { body.answers[0].value = 1.5 }],
    ['below range', (body: ReturnType<typeof postBody>) => { body.answers[0].value = -1 }],
    ['above range', (body: ReturnType<typeof postBody>) => { body.answers[0].value = 11 }],
  ])('rejects an invalid post instrument: %s', async (_label, mutate) => {
    const body = postBody()
    mutate(body)
    await expect(parseQuestionnaireRequest(request(body))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('rejects zero for the first fourteen task items but permits confidence zero', async () => {
    const body = taskBody()
    body.answers[0].value = 0
    await expect(parseQuestionnaireRequest(request(body))).rejects.toMatchObject({
      code: 'INVALID_QUESTIONNAIRE',
    })
  })

  it('rejects a default-looking task answer unless touched is explicitly true', async () => {
    const body = taskBody()
    ;(body.answers[0] as { touched: boolean }).touched = false
    await expect(parseQuestionnaireRequest(request(body))).rejects.toMatchObject({
      code: 'QUESTIONNAIRE_INCOMPLETE',
    })
  })

  it('rejects manipulation as a separately submitted public phase', async () => {
    const body = { ...postBody(), phase: 'manipulation' }
    await expect(parseQuestionnaireRequest(request(body))).rejects.toMatchObject({
      status: 400,
      code: 'PHASE_NOT_AVAILABLE',
    })
  })

  it.each([
    ['wrong version', () => ({ ...postBody(), instrumentVersion: 'wrong' })],
    ['private sequence', () => ({ ...postBody(), sequenceNo: 4 })],
    ['identity', () => ({ ...postBody(), identity: { fullName: 'No' } })],
    ['final result', () => ({ ...postBody(), finalCandidateId: 'B' })],
    ['RDI', () => ({ ...postBody(), RDI: 80 })],
  ])('rejects unknown or client-authoritative fields: %s', async (_label, build) => {
    await expect(parseQuestionnaireRequest(request(build()))).rejects.toMatchObject({
      status: 400,
    })
  })
})
