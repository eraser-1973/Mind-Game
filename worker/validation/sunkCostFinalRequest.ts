import {
  readIdempotencyKey,
  readResearchJson,
  requireUuid,
  ResearchIntakeRequestError,
} from './researchIntakeRequest'
import type { FormalCandidateId } from './formalGameRequest'

type JsonRecord = Record<string, unknown>

type Stage6BaseInput = {
  eventId: string
  sessionId: string
  clientSequence: number | null
}

export type SunkCostShowInput = Stage6BaseInput & {
  clientShownAt: string
}

export type SunkCostChoiceInput = Stage6BaseInput & {
  sunkEventId: string
  choice: 'continue' | 'stop_loss' | 'give_up'
  clientSubmittedAt: string
}

export type ActiveFinalDecisionInput = Stage6BaseInput & {
  candidateId: FormalCandidateId
  confidence: number
  clientSubmittedAt: string
}

export type TimeoutFinalDecisionInput = Stage6BaseInput & {
  clientObservedAt: string
}

function invalid(code: string, message: string): ResearchIntakeRequestError {
  return new ResearchIntakeRequestError(400, code, message)
}

function exactKeys(body: JsonRecord, required: readonly string[]): void {
  const expected = new Set(required)
  const unknown = Object.keys(body).filter((key) => !expected.has(key))
  if (unknown.length > 0) {
    throw invalid('UNKNOWN_FIELD', 'The request contains an unsupported field.')
  }
  if (Object.keys(body).length !== required.length || required.some((key) => !(key in body))) {
    throw invalid('INVALID_REQUEST', 'The Stage 6 request is invalid.')
  }
}

function keysWithOptionalSequence(body: JsonRecord, required: readonly string[]): string[] {
  return 'clientSequence' in body ? [...required, 'clientSequence'] : [...required]
}

function iso(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw invalid('INVALID_TIMESTAMP', 'A valid ISO timestamp is required.')
  }
  return value
}

function sequence(value: unknown): number | null {
  if (value === undefined) return null
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw invalid('INVALID_CLIENT_SEQUENCE', 'The client sequence must be a non-negative integer.')
  }
  return value as number
}

function candidate(value: unknown): FormalCandidateId {
  if (value !== 'A' && value !== 'B' && value !== 'C' && value !== 'D' && value !== 'E') {
    throw invalid('INVALID_CANDIDATE', 'The candidate identifier is invalid.')
  }
  return value
}

function confidence(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    throw invalid('INVALID_CONFIDENCE', 'Confidence must be an integer from 0 to 100.')
  }
  return value as number
}

export async function parseSunkCostShowRequest(request: Request): Promise<SunkCostShowInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'clientShownAt']
  exactKeys(body, keysWithOptionalSequence(body, baseKeys))
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    clientShownAt: iso(body.clientShownAt),
    clientSequence: sequence(body.clientSequence),
  }
}

export async function parseSunkCostChoiceRequest(request: Request): Promise<SunkCostChoiceInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'sunkEventId', 'choice', 'clientSubmittedAt']
  exactKeys(body, keysWithOptionalSequence(body, baseKeys))
  if (body.choice !== 'continue' && body.choice !== 'stop_loss' && body.choice !== 'give_up') {
    throw invalid('INVALID_SUNK_COST_CHOICE', 'The sunk cost choice is invalid.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    sunkEventId: requireUuid(body.sunkEventId),
    choice: body.choice,
    clientSubmittedAt: iso(body.clientSubmittedAt),
    clientSequence: sequence(body.clientSequence),
  }
}

export async function parseActiveFinalDecisionRequest(
  request: Request,
): Promise<ActiveFinalDecisionInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'candidateId', 'confidence', 'clientSubmittedAt']
  exactKeys(body, keysWithOptionalSequence(body, baseKeys))
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    candidateId: candidate(body.candidateId),
    confidence: confidence(body.confidence),
    clientSubmittedAt: iso(body.clientSubmittedAt),
    clientSequence: sequence(body.clientSequence),
  }
}

export async function parseTimeoutFinalDecisionRequest(
  request: Request,
): Promise<TimeoutFinalDecisionInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'clientObservedAt']
  exactKeys(body, keysWithOptionalSequence(body, baseKeys))
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    clientObservedAt: iso(body.clientObservedAt),
    clientSequence: sequence(body.clientSequence),
  }
}
