import { afterEach, describe, expect, it } from 'vitest'
import type { Miniflare } from 'miniflare'
import {
  parseActiveFinalDecisionRequest,
  parseSunkCostChoiceRequest,
  parseSunkCostShowRequest,
  parseTimeoutFinalDecisionRequest,
} from '../worker/validation/sunkCostFinalRequest'
import { createWorkerRuntime } from './runtime'

let runtime: Miniflare | undefined
afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

function request(body: unknown, key = crypto.randomUUID()) {
  return new Request('https://example.test/api/stage6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  })
}

const sessionId = '2dc606ae-3d1a-4bcd-a8e9-9f92219791ca'
const sunkEventId = '11ef1150-9676-4a3a-9998-c11007c24c5a'
const at = '2026-08-01T00:10:00.000Z'

describe('Stage 6 strict request validation', () => {
  it('parses only the public sunk cost show fields', async () => {
    await expect(parseSunkCostShowRequest(request({
      sessionId, clientShownAt: at, clientSequence: 16,
    }))).resolves.toMatchObject({ sessionId, clientShownAt: at, clientSequence: 16 })
    for (const forbidden of [
      'candidateId', 'riskEvidenceIds', 'isKeyRisk', 'pointsInvested',
      'remainingSec', 'deadlineAt', 'ruleVersion',
    ]) {
      await expect(parseSunkCostShowRequest(request({
        sessionId, clientShownAt: at, clientSequence: 16, [forbidden]: 'private',
      }))).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' })
    }
  })

  it.each(['continue', 'stop_loss', 'give_up'] as const)(
    'accepts the participant sunk choice %s', async (choice) => {
      await expect(parseSunkCostChoiceRequest(request({
        sessionId, sunkEventId, choice, clientSubmittedAt: at, clientSequence: 17,
      }))).resolves.toMatchObject({ sessionId, sunkEventId, choice })
    },
  )

  it('rejects not_triggered and unknown choice fields', async () => {
    await expect(parseSunkCostChoiceRequest(request({
      sessionId, sunkEventId, choice: 'not_triggered', clientSubmittedAt: at,
    }))).rejects.toMatchObject({ code: 'INVALID_SUNK_COST_CHOICE' })
    await expect(parseSunkCostChoiceRequest(request({
      sessionId, sunkEventId, choice: 'continue', clientSubmittedAt: at,
      pointsRemaining: 4,
    }))).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' })
  })

  it('accepts active candidate/confidence boundaries and rejects server-owned fields', async () => {
    for (const confidence of [0, 100]) {
      await expect(parseActiveFinalDecisionRequest(request({
        sessionId, candidateId: 'B', confidence, clientSubmittedAt: at,
        clientSequence: 18,
      }))).resolves.toMatchObject({ sessionId, candidateId: 'B', confidence })
    }
    for (const forbidden of [
      'submitMode', 'sourceStage', 'selectionOrigin', 'autoSelected',
      'remainingSec', 'pointsRemaining', 'benchmark', 'trueAbility',
    ]) {
      await expect(parseActiveFinalDecisionRequest(request({
        sessionId, candidateId: 'B', confidence: 50, clientSubmittedAt: at,
        [forbidden]: 'private',
      }))).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' })
    }
    for (const confidence of [-1, 101, 1.5]) {
      await expect(parseActiveFinalDecisionRequest(request({
        sessionId, candidateId: 'B', confidence, clientSubmittedAt: at,
      }))).rejects.toMatchObject({ code: 'INVALID_CONFIDENCE' })
    }
  })

  it('parses timeout observation without accepting candidate or confidence', async () => {
    await expect(parseTimeoutFinalDecisionRequest(request({
      sessionId, clientObservedAt: at, clientSequence: 19,
    }))).resolves.toMatchObject({ sessionId, clientObservedAt: at })
    await expect(parseTimeoutFinalDecisionRequest(request({
      sessionId, clientObservedAt: at, candidateId: 'A',
    }))).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' })
  })

  it('requires JSON, UUID idempotency, valid ISO time, and at most 16 KiB', async () => {
    await expect(parseSunkCostShowRequest(request({
      sessionId, clientShownAt: 'not-a-date',
    }))).rejects.toMatchObject({ code: 'INVALID_TIMESTAMP' })
    await expect(parseSunkCostShowRequest(request({ sessionId, clientShownAt: at }, 'bad')))
      .rejects.toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' })
    const nonJson = new Request('https://example.test/api/stage6', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Idempotency-Key': crypto.randomUUID() },
      body: '{}',
    })
    await expect(parseSunkCostShowRequest(nonJson)).rejects.toMatchObject({ status: 415 })
    const tooLarge = request({ sessionId, clientShownAt: at, padding: 'x'.repeat(17_000) })
    await expect(parseSunkCostShowRequest(tooLarge)).rejects.toMatchObject({ status: 413 })
  })
})

describe('Stage 6 session version projection', () => {
  it('copies sunk-1.0.0 from the active configuration into the session and safe response', async () => {
    const created = await createWorkerRuntime()
    runtime = created.runtime
    const response = await created.runtime.dispatchFetch('https://example.test/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        mode: 'formal', identity: { studentId: 'STAGE6-VERSION' }, clientVersion: 'test',
      }),
    })
    expect(response.status).toBe(201)
    const envelope = await response.json() as { data: {
      sessionId: string
      versions: { sunkCostRule: string }
    } }
    expect(envelope.data.versions.sunkCostRule).toBe('sunk-1.0.0')
    const row = await created.db.prepare(
      'SELECT sunk_cost_rule_version FROM sessions WHERE session_id=?',
    ).bind(envelope.data.sessionId).first<{ sunk_cost_rule_version: string }>()
    expect(row?.sunk_cost_rule_version).toBe('sunk-1.0.0')
  })
})
