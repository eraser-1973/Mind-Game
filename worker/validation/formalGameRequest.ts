import {
  readIdempotencyKey,
  readResearchJson,
  requireUuid,
  ResearchIntakeRequestError,
} from './researchIntakeRequest'

type JsonRecord = Record<string, unknown>
export type FormalCandidateId = 'A' | 'B' | 'C' | 'D' | 'E'

export type StartGameInput = {
  eventId: string
  sessionId: string
  clientStartedAt: string
  clientVersion: string
}

export type FormalRatingStage = 'T1' | 'T2' | 'T3'

export type FormalRatingInput = {
  eventId: string
  sessionId: string
  candidateId: FormalCandidateId
  stage: FormalRatingStage
  ratingValue: number
  clientSubmittedAt: string
  clientSequence: number | null
}

export type FormalStageChoiceInput = {
  eventId: string
  sessionId: string
  stage: FormalRatingStage
  candidateId: FormalCandidateId
  confidence: number
  clientSubmittedAt: string
  clientSequence: number | null
}

export type EvidenceUnlockInput = {
  eventId: string
  sessionId: string
  candidateId: FormalCandidateId
  level: 'shallow' | 'deep'
  clientAt: string
  clientSequence: number | null
}

function invalid(code: string, message: string, status = 400): ResearchIntakeRequestError {
  return new ResearchIntakeRequestError(status, code, message)
}

function exactKeys(body: JsonRecord, keys: readonly string[]): void {
  const expected = new Set(keys)
  const unknown = Object.keys(body).filter((key) => !expected.has(key))
  if (unknown.length > 0) {
    throw invalid('UNKNOWN_FIELD', 'The request contains an unsupported field.')
  }
  if (Object.keys(body).length !== keys.length || keys.some((key) => !(key in body))) {
    throw invalid('INVALID_REQUEST', 'The formal game request is invalid.')
  }
}

function iso(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw invalid('INVALID_TIMESTAMP', 'A valid ISO timestamp is required.')
  }
  return value
}

function candidate(value: unknown): FormalCandidateId {
  if (!['A', 'B', 'C', 'D', 'E'].includes(String(value))) {
    throw invalid('INVALID_CANDIDATE', 'The candidate identifier is invalid.')
  }
  return value as FormalCandidateId
}

function optionalSequence(value: unknown): number | null {
  if (value === undefined) return null
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw invalid('INVALID_CLIENT_SEQUENCE', 'The client sequence must be a non-negative integer.')
  }
  return value as number
}

function ratingStage(value: unknown): FormalRatingStage {
  if (value !== 'T1' && value !== 'T2' && value !== 'T3') {
    throw invalid('INVALID_STAGE', 'The rating stage is invalid.')
  }
  return value
}

export async function parseStartGameRequest(request: Request): Promise<StartGameInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  exactKeys(body, ['sessionId', 'clientStartedAt', 'clientVersion'])
  if (typeof body.clientVersion !== 'string' || !body.clientVersion.trim() || body.clientVersion.length > 100) {
    throw invalid('INVALID_CLIENT_VERSION', 'A valid client version is required.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    clientStartedAt: iso(body.clientStartedAt),
    clientVersion: body.clientVersion.trim(),
  }
}

export async function parseFormalRatingRequest(request: Request): Promise<FormalRatingInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'candidateId', 'stage', 'ratingValue', 'clientSubmittedAt']
  const keys = 'clientSequence' in body ? [...baseKeys, 'clientSequence'] : baseKeys
  exactKeys(body, keys)
  const stage = ratingStage(body.stage)
  if (!Number.isInteger(body.ratingValue) || (body.ratingValue as number) < 0 || (body.ratingValue as number) > 100) {
    throw invalid('INVALID_RATING', 'The rating must be an integer from 0 to 100.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    candidateId: candidate(body.candidateId),
    stage,
    ratingValue: body.ratingValue as number,
    clientSubmittedAt: iso(body.clientSubmittedAt),
    clientSequence: optionalSequence(body.clientSequence),
  }
}

export async function parseFormalStageChoiceRequest(request: Request): Promise<FormalStageChoiceInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'stage', 'candidateId', 'confidence', 'clientSubmittedAt']
  const keys = 'clientSequence' in body ? [...baseKeys, 'clientSequence'] : baseKeys
  exactKeys(body, keys)
  const stage = ratingStage(body.stage)
  if (!Number.isInteger(body.confidence) || (body.confidence as number) < 0 || (body.confidence as number) > 100) {
    throw invalid('INVALID_CONFIDENCE', 'Confidence must be an integer from 0 to 100.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    stage,
    candidateId: candidate(body.candidateId),
    confidence: body.confidence as number,
    clientSubmittedAt: iso(body.clientSubmittedAt),
    clientSequence: optionalSequence(body.clientSequence),
  }
}

export async function parseEvidenceUnlockRequest(request: Request): Promise<EvidenceUnlockInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  const baseKeys = ['sessionId', 'candidateId', 'level', 'clientAt']
  const keys = 'clientSequence' in body ? [...baseKeys, 'clientSequence'] : baseKeys
  exactKeys(body, keys)
  if (body.level !== 'shallow' && body.level !== 'deep') {
    throw invalid('INVALID_EVIDENCE_LEVEL', 'The evidence level is invalid.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    candidateId: candidate(body.candidateId),
    level: body.level,
    clientAt: iso(body.clientAt),
    clientSequence: optionalSequence(body.clientSequence),
  }
}

export const parseT1RatingRequest = parseFormalRatingRequest
export const parseT1StageChoiceRequest = parseFormalStageChoiceRequest
export type T1RatingInput = FormalRatingInput
export type T1StageChoiceInput = FormalStageChoiceInput
