import type {
  DemographicData,
  FormalConsentResponse,
  FormalDemographicsResponse,
  FormalPreTaskResponse,
  FormalResumeData,
  StateAssessmentData,
  StateAssessmentId,
} from '../types/game'
import { isFormalSessionContext } from '../utils/formalSessionContext'

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export class FormalResearchApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requestId: string | null = null,
  ) {
    super(message)
    this.name = 'FormalResearchApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

async function requestApi<T>(
  path: string,
  init: RequestInit,
  parseData: (value: unknown) => T | null,
  fetchImpl: FetchLike,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(path, init)
  } catch {
    throw new FormalResearchApiError(
      null,
      'NETWORK_ERROR',
      '暂时无法连接实验服务，请检查网络后重试。',
      true,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new FormalResearchApiError(
      response.status,
      'INVALID_RESPONSE',
      '实验服务返回了无法识别的响应，请重试。',
      true,
    )
  }
  const envelope = isRecord(payload) ? payload : null
  if (!response.ok) {
    const error = isRecord(envelope?.error) ? envelope?.error : {}
    const code = typeof error.code === 'string' ? error.code : `HTTP_${response.status}`
    const message = typeof error.message === 'string' ? error.message : '实验服务暂时无法处理请求。'
    throw new FormalResearchApiError(
      response.status,
      code,
      message,
      response.status >= 500,
      typeof envelope?.requestId === 'string' ? envelope.requestId : null,
    )
  }
  const data = envelope?.ok === true ? parseData(envelope.data) : null
  if (!data) {
    throw new FormalResearchApiError(
      response.status,
      'INVALID_RESPONSE',
      '实验服务返回了无法识别的响应，请重试。',
      true,
      typeof envelope?.requestId === 'string' ? envelope.requestId : null,
    )
  }
  return data
}

function postInit(body: unknown, idempotencyKey: string): RequestInit {
  return {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  }
}

function parseConsent(value: unknown): FormalConsentResponse | null {
  if (!isRecord(value) || !isRecord(value.consent)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    value.currentStep !== 'demographics' ||
    value.consent.accepted !== true ||
    typeof value.consent.version !== 'string' ||
    !isIso(value.consent.acceptedAt)
  ) return null
  return value as FormalConsentResponse
}

function isDemographics(value: unknown): value is DemographicData {
  if (!isRecord(value) || !Array.isArray(value.relatedExperience)) return false
  return ['ageRange', 'gender', 'education', 'grade', 'majorCategory'].every(
    (key) => typeof value[key] === 'string',
  ) && value.relatedExperience.every((item) => typeof item === 'string')
}

function parseDemographics(value: unknown): FormalDemographicsResponse | null {
  if (!isRecord(value) || !isDemographics(value.demographics)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    value.currentStep !== 'pre_task' ||
    !Number.isInteger(value.revisionNo) ||
    !isIso(value.submittedAt)
  ) return null
  return value as FormalDemographicsResponse
}

function parsePreTask(value: unknown): FormalPreTaskResponse | null {
  if (!isRecord(value)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    value.currentStep !== 'game_ready' ||
    typeof value.submissionId !== 'string' ||
    value.itemCount !== 5
  ) return null
  return value as FormalPreTaskResponse
}

const itemIds: StateAssessmentId[] = [
  'stress', 'fatigue', 'attention', 'mood', 'physicalDiscomfort',
]

function parseResume(value: unknown): FormalResumeData | null {
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.game)) return null
  if (value.session.mode !== 'formal' || !isFormalSessionContext(value.session)) return null
  if (value.consent !== null && !isRecord(value.consent)) return null
  if (value.demographics !== null && !isRecord(value.demographics)) return null
  if (value.preTask !== null && !isRecord(value.preTask)) return null
  if (
    (value.game.startedAt !== null && !isIso(value.game.startedAt)) ||
    (value.game.deadlineAt !== null && !isIso(value.game.deadlineAt)) ||
    value.game.resumeSupported !== false
  ) return null
  return value as FormalResumeData
}

export function saveFormalConsent(
  input: {
    sessionId: string
    accepted: true
    consentVersion: 'consent-1.0.0'
    clientAcceptedAt: string
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalConsentResponse> {
  return requestApi('/api/consent', postInit(input, idempotencyKey), parseConsent, fetchImpl)
}

export function saveFormalDemographics(
  input: { sessionId: string; demographics: DemographicData; clientSubmittedAt: string },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalDemographicsResponse> {
  return requestApi('/api/demographics', postInit(input, idempotencyKey), parseDemographics, fetchImpl)
}

export function saveFormalPreTaskQuestionnaire(
  input: {
    sessionId: string
    values: StateAssessmentData
    clientStartedAt: string
    clientSubmittedAt: string
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalPreTaskResponse> {
  const body = {
    sessionId: input.sessionId,
    phase: 'pre',
    instrumentVersion: 'state-assessment-pre-1.0.0',
    clientStartedAt: input.clientStartedAt,
    clientSubmittedAt: input.clientSubmittedAt,
    answers: itemIds.map((itemId) => ({
      itemId,
      value: input.values[itemId],
      touched: true,
      answeredAt: input.clientSubmittedAt,
    })),
  }
  return requestApi('/api/questionnaires', postInit(body, idempotencyKey), parsePreTask, fetchImpl)
}

export function resumeFormalSession(
  sessionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalResumeData> {
  return requestApi(
    `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
    { method: 'GET', credentials: 'include' },
    parseResume,
    fetchImpl,
  )
}
