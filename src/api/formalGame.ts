import type {
  FormalEvidenceItem,
  FormalEvidenceUnlock,
  FormalGameSnapshot,
  FormalGameStage,
  FormalGameStartResponse,
  FormalRating,
  FormalRatingResponse,
  FormalRatingStage,
  FormalStageChoice,
  FormalStageChoiceResponse,
  FormalStageStatus,
  FormalT1RatingResponse,
  FormalT1StageChoiceResponse,
} from '../types/formalGame'
import type { PublicCandidateId } from '../types/game'
import { isCandidateDisplayOrder } from '../utils/formalSessionContext'
import { FormalResearchApiError, type FetchLike } from './formalResearch'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isCandidate(value: unknown): value is PublicCandidateId {
  return ['A', 'B', 'C', 'D', 'E'].includes(String(value))
}

function isRatingStage(value: unknown): value is FormalRatingStage {
  return value === 'T1' || value === 'T2' || value === 'T3'
}

function isGameStage(value: unknown): value is FormalGameStage {
  return value === 'T1' || value === 'T1_COMPLETE' || value === 'T2' || value === 'T3'
}

function isStageStatus(value: unknown): value is FormalStageStatus {
  return [
    'T1_ACTIVE', 'T1_COMPLETE', 'T2_ACTIVE', 'T2_COMPLETE',
    'T3_ACTIVE', 'T3_COMPLETE',
  ].includes(String(value))
}

function isScore(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function parseFormalRating(value: unknown): FormalRating | null {
  if (!isRecord(value)) return null
  if (
    !isCandidate(value.candidateId) ||
    !isRatingStage(value.stage) ||
    !isScore(value.ratingValue) ||
    !isStringArray(value.evidenceIdsSeen) ||
    value.sealed !== true ||
    !Number.isInteger(value.sequenceNo) ||
    !isIso(value.serverSubmittedAt)
  ) return null
  return value as FormalRating
}

export function parseFormalStageChoice(value: unknown): FormalStageChoice | null {
  if (!isRecord(value)) return null
  if (
    !isRatingStage(value.stage) ||
    !isCandidate(value.candidateId) ||
    !isScore(value.confidence) ||
    value.sealed !== true ||
    !Number.isInteger(value.sequenceNo) ||
    !isIso(value.serverSubmittedAt)
  ) return null
  return value as FormalStageChoice
}

function parseEvidenceItem(value: unknown): FormalEvidenceItem | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' || !value.id ||
    typeof value.title !== 'string' || !value.title ||
    typeof value.content !== 'string' || !value.content ||
    (value.polarity !== 'positive' && value.polarity !== 'negative') ||
    !Number.isInteger(value.order) || (value.order as number) < 1 ||
    Object.keys(value).some((key) => !['id', 'title', 'content', 'polarity', 'order'].includes(key))
  ) return null
  return value as FormalEvidenceItem
}

export function parseFormalEvidenceUnlock(value: unknown): FormalEvidenceUnlock | null {
  if (!isRecord(value) || !isRecord(value.points) || !Array.isArray(value.evidence)) return null
  if (
    !isCandidate(value.candidateId) ||
    (value.level !== 'shallow' && value.level !== 'deep') ||
    value.ratingStage !== (value.level === 'shallow' ? 'T2' : 'T3') ||
    !Number.isInteger(value.sequenceNo) || !isIso(value.serverAt) ||
    !Number.isInteger(value.points.before) || !Number.isInteger(value.points.cost) ||
    !Number.isInteger(value.points.after) ||
    (value.points.before as number) < 0 || (value.points.cost as number) <= 0 ||
    (value.points.after as number) < 0 ||
    value.points.after !== (value.points.before as number) - (value.points.cost as number) ||
    !value.evidence.every((item) => Boolean(parseEvidenceItem(item)))
  ) return null
  return value as unknown as FormalEvidenceUnlock
}

function parseRatingResponse(value: unknown): FormalRatingResponse | null {
  const rating = parseFormalRating(value)
  if (!rating || !isRecord(value)) return null
  if (
    typeof value.created !== 'boolean' || typeof value.sessionId !== 'string' ||
    !Number.isInteger(value.ratedCandidateCount) ||
    !Number.isInteger(value.requiredCandidateCount) ||
    typeof value.allStageRated !== 'boolean' || typeof value.allT1Rated !== 'boolean'
  ) return null
  return value as FormalRatingResponse
}

function parseChoiceResponse(value: unknown): FormalStageChoiceResponse | null {
  const choice = parseFormalStageChoice(value)
  if (!choice || !isRecord(value)) return null
  if (
    typeof value.created !== 'boolean' || typeof value.sessionId !== 'string' ||
    !isGameStage(value.currentStage) || !isStageStatus(value.stageStatus)
  ) return null
  return value as FormalStageChoiceResponse
}

function parseSnapshotFields(value: Record<string, unknown>): boolean {
  if (
    !isRecord(value.points) || !Array.isArray(value.ratings) ||
    !Array.isArray(value.stageChoices) || !Array.isArray(value.evidenceUnlocks)
  ) return false
  return (
    value.durationSec === 900 &&
    isIso(value.startedAt) && isIso(value.deadlineAt) && isIso(value.serverNow) &&
    Number.isInteger(value.remainingSec) && (value.remainingSec as number) >= 0 &&
    typeof value.expired === 'boolean' &&
    isGameStage(value.currentStage) && isStageStatus(value.stageStatus) &&
    Number.isInteger(value.points.total) && (value.points.total as number) > 0 &&
    Number.isInteger(value.points.remaining) && (value.points.remaining as number) >= 0 &&
    (value.points.remaining as number) <= (value.points.total as number) &&
    value.ratings.every((rating) => Boolean(parseFormalRating(rating))) &&
    value.stageChoices.every((choice) => Boolean(parseFormalStageChoice(choice))) &&
    (value.stageChoice === null || Boolean(parseFormalStageChoice(value.stageChoice))) &&
    value.evidenceUnlocks.every((unlock) => Boolean(parseFormalEvidenceUnlock(unlock)))
  )
}

function parseStart(value: unknown): FormalGameStartResponse | null {
  if (!isRecord(value) || !parseSnapshotFields(value)) return null
  if (
    typeof value.created !== 'boolean' || typeof value.sessionId !== 'string' ||
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

export async function requestFormalGame<T>(
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
    throw new FormalResearchApiError(null, 'NETWORK_ERROR', '暂时无法连接实验服务，请重试。', true)
  }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    throw new FormalResearchApiError(response.status, 'INVALID_RESPONSE', '实验服务响应无法识别。', true)
  }
  const dataEnvelope = isRecord(envelope) ? envelope : null
  if (!response.ok) {
    const error = isRecord(dataEnvelope?.error) ? dataEnvelope.error : null
    throw new FormalResearchApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`,
      typeof error?.message === 'string' ? error.message : '实验服务暂时无法处理请求。',
      response.status >= 500,
      typeof dataEnvelope?.requestId === 'string' ? dataEnvelope.requestId : null,
    )
  }
  const parsed = dataEnvelope?.ok === true ? parser(dataEnvelope.data) : null
  if (!parsed) {
    throw new FormalResearchApiError(response.status, 'INVALID_RESPONSE', '实验服务响应无法识别。', true)
  }
  return parsed
}

export function startFormalGame(
  input: { sessionId: string; clientStartedAt: string; clientVersion: string },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalGameStartResponse> {
  return requestFormalGame(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/start`,
    input, idempotencyKey, parseStart, fetchImpl,
  )
}

export function submitFormalRating(
  input: {
    sessionId: string
    candidateId: PublicCandidateId
    stage: FormalRatingStage
    ratingValue: number
    clientSubmittedAt: string
    clientSequence?: number
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalRatingResponse> {
  return requestFormalGame('/api/ratings', input, idempotencyKey, parseRatingResponse, fetchImpl)
}

export function submitFormalStageChoice(
  input: {
    sessionId: string
    stage: FormalRatingStage
    candidateId: PublicCandidateId
    confidence: number
    clientSubmittedAt: string
    clientSequence?: number
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalStageChoiceResponse> {
  return requestFormalGame('/api/stage-choices', input, idempotencyKey, parseChoiceResponse, fetchImpl)
}

export function submitFormalT1Rating(
  input: Omit<Parameters<typeof submitFormalRating>[0], 'stage'>,
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalT1RatingResponse> {
  return submitFormalRating({ ...input, stage: 'T1' }, idempotencyKey, fetchImpl) as Promise<FormalT1RatingResponse>
}

export function submitFormalT1StageChoice(
  input: Omit<Parameters<typeof submitFormalStageChoice>[0], 'stage'>,
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalT1StageChoiceResponse> {
  return submitFormalStageChoice({ ...input, stage: 'T1' }, idempotencyKey, fetchImpl) as Promise<FormalT1StageChoiceResponse>
}
