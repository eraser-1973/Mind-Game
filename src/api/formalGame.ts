import type {
  FormalGameSnapshot,
  FormalGameStartResponse,
  FormalT1RatingResponse,
  FormalT1StageChoiceResponse,
} from '../types/formalGame'
import type { PublicCandidateId } from '../types/game'
import { isCandidateDisplayOrder } from '../utils/formalSessionContext'
import { FormalResearchApiError, type FetchLike } from './formalResearch'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isCandidate(value: unknown): value is PublicCandidateId {
  return ['A', 'B', 'C', 'D', 'E'].includes(String(value))
}

function parseRating(value: unknown): FormalT1RatingResponse | null {
  if (!isRecord(value)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    !isCandidate(value.candidateId) ||
    value.stage !== 'T1' ||
    !Number.isInteger(value.ratingValue) ||
    (value.ratingValue as number) < 0 ||
    (value.ratingValue as number) > 100 ||
    value.sealed !== true ||
    !Number.isInteger(value.sequenceNo) ||
    !isIso(value.serverSubmittedAt) ||
    !Number.isInteger(value.ratedCandidateCount) ||
    value.requiredCandidateCount !== 5 ||
    typeof value.allT1Rated !== 'boolean'
  ) return null
  return value as FormalT1RatingResponse
}

function parseChoice(value: unknown): FormalT1StageChoiceResponse | null {
  if (!isRecord(value)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    value.stage !== 'T1' ||
    value.currentStage !== 'T1_COMPLETE' ||
    !isCandidate(value.candidateId) ||
    !Number.isInteger(value.confidence) ||
    (value.confidence as number) < 0 ||
    (value.confidence as number) > 100 ||
    value.sealed !== true ||
    !Number.isInteger(value.sequenceNo) ||
    !isIso(value.serverSubmittedAt)
  ) return null
  return value as FormalT1StageChoiceResponse
}

function parseSnapshotFields(value: Record<string, unknown>): boolean {
  if (!isRecord(value.points) || !Array.isArray(value.ratings)) return false
  return (
    value.durationSec === 900 &&
    isIso(value.startedAt) &&
    isIso(value.deadlineAt) &&
    isIso(value.serverNow) &&
    Number.isInteger(value.remainingSec) &&
    (value.remainingSec as number) >= 0 &&
    typeof value.expired === 'boolean' &&
    (value.currentStage === 'T1' || value.currentStage === 'T1_COMPLETE') &&
    value.points.total === 5 && value.points.remaining === 5 &&
    value.ratings.every((rating) => parseRating({
      ...(rating as object), created: true, sessionId: 'projection',
      ratedCandidateCount: 1, requiredCandidateCount: 5, allT1Rated: false,
    })) &&
    (value.stageChoice === null || Boolean(parseChoice({
      ...(value.stageChoice as object), created: true, sessionId: 'projection',
      currentStage: 'T1_COMPLETE',
    })))
  )
}

function parseStart(value: unknown): FormalGameStartResponse | null {
  if (!isRecord(value) || !parseSnapshotFields(value)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    value.currentStep !== 'playing' ||
    !isCandidateDisplayOrder(value.candidateDisplayOrder) ||
    value.initialOpenedCandidate !== value.candidateDisplayOrder[0]
  ) return null
  return value as FormalGameStartResponse
}

export function parseFormalGameSnapshot(value: unknown): FormalGameSnapshot | null {
  if (!isRecord(value) || !parseSnapshotFields(value)) return null
  if (value.started !== true || value.resumeSupported !== true) return null
  return value as FormalGameSnapshot
}

async function request<T>(
  path: string,
  body: unknown,
  idempotencyKey: string,
  parser: (value: unknown) => T | null,
  fetchImpl: FetchLike,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new FormalResearchApiError(null, 'NETWORK_ERROR', '\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5\u5b9e\u9a8c\u670d\u52a1\uff0c\u8bf7\u91cd\u8bd5\u3002', true)
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw new FormalResearchApiError(response.status, 'INVALID_RESPONSE', '\u5b9e\u9a8c\u670d\u52a1\u54cd\u5e94\u65e0\u6cd5\u8bc6\u522b\u3002', true)
  }
  const dataEnvelope = isRecord(envelope) ? envelope : null
  if (!response.ok) {
    const error = isRecord(dataEnvelope?.error) ? dataEnvelope.error : null
    throw new FormalResearchApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`,
      typeof error?.message === 'string' ? error.message : '\u5b9e\u9a8c\u670d\u52a1\u6682\u65f6\u65e0\u6cd5\u5904\u7406\u8bf7\u6c42\u3002',
      response.status >= 500,
      typeof dataEnvelope?.requestId === 'string' ? dataEnvelope.requestId : null,
    )
  }
  const parsed = dataEnvelope?.ok === true ? parser(dataEnvelope.data) : null
  if (!parsed) {
    throw new FormalResearchApiError(
      response.status,
      'INVALID_RESPONSE',
      '\u5b9e\u9a8c\u670d\u52a1\u54cd\u5e94\u65e0\u6cd5\u8bc6\u522b\u3002',
      true,
    )
  }
  return parsed
}

export function startFormalGame(
  input: { sessionId: string; clientStartedAt: string; clientVersion: string },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalGameStartResponse> {
  return request(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/start`,
    input,
    idempotencyKey,
    parseStart,
    fetchImpl,
  )
}

export function submitFormalT1Rating(
  input: {
    sessionId: string
    candidateId: PublicCandidateId
    ratingValue: number
    clientSubmittedAt: string
    clientSequence?: number
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalT1RatingResponse> {
  return request('/api/ratings', { ...input, stage: 'T1' }, idempotencyKey, parseRating, fetchImpl)
}

export function submitFormalT1StageChoice(
  input: {
    sessionId: string
    candidateId: PublicCandidateId
    confidence: number
    clientSubmittedAt: string
    clientSequence?: number
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalT1StageChoiceResponse> {
  return request('/api/stage-choices', { ...input, stage: 'T1' }, idempotencyKey, parseChoice, fetchImpl)
}
