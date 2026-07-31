import type {
  CreateFormalSessionRequest,
  CreateFormalSessionResponse,
} from '../types/game'
import { isFormalSessionContext } from '../utils/formalSessionContext'

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export class FormalSessionApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requestId: string | null = null,
  ) {
    super(message)
    this.name = 'FormalSessionApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseSuccessData(value: unknown): CreateFormalSessionResponse | null {
  if (!isRecord(value)) return null
  const context = {
    participantId: value.participantId,
    sessionId: value.sessionId,
    configSetId: value.configSetId,
    versions: value.versions,
    candidateDisplayOrder: value.candidateDisplayOrder,
    initialOpenedCandidate: value.initialOpenedCandidate,
    createdAt: value.createdAt,
  }

  if (
    !isFormalSessionContext(context) ||
    typeof value.created !== 'boolean' ||
    value.mode !== 'formal' ||
    value.currentStep !== 'demographics'
  ) {
    return null
  }

  return {
    ...context,
    created: value.created,
    mode: 'formal',
    currentStep: 'demographics',
  }
}

export async function createFormalSession(
  request: CreateFormalSessionRequest,
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<CreateFormalSessionResponse> {
  let response: Response
  try {
    response = await fetchImpl('/api/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(request),
    })
  } catch {
    throw new FormalSessionApiError(
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
    throw new FormalSessionApiError(
      response.status,
      'INVALID_RESPONSE',
      '实验服务返回了无法识别的响应，请重试。',
      true,
    )
  }

  if (!response.ok) {
    const envelope = isRecord(payload) ? payload : {}
    const error = isRecord(envelope.error) ? envelope.error : {}
    const code = typeof error.code === 'string' ? error.code : `HTTP_${response.status}`
    const message =
      typeof error.message === 'string'
        ? error.message
        : '暂时无法创建实验会话。'
    const requestId =
      typeof envelope.requestId === 'string' ? envelope.requestId : null

    throw new FormalSessionApiError(
      response.status,
      code,
      message,
      response.status >= 500,
      requestId,
    )
  }

  const envelope = isRecord(payload) ? payload : null
  const data = envelope?.ok === true ? parseSuccessData(envelope.data) : null
  if (!data) {
    throw new FormalSessionApiError(
      response.status,
      'INVALID_RESPONSE',
      '实验服务返回了无法识别的响应，请重试。',
      true,
      typeof envelope?.requestId === 'string' ? envelope.requestId : null,
    )
  }

  return data
}
