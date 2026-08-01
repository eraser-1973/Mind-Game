import { authenticateFormalSession, SessionAuthError } from '../auth/sessionAuth'
import type { Env } from '../env'
import { errorResponse, successResponse } from '../http/responses'
import {
  completeFormalSession,
  FormalCompletionError,
} from '../services/formalCompletion'
import {
  parseFormalCompletionRequest,
} from '../validation/formalCompletionRequest'
import {
  requireUuid,
  ResearchIntakeRequestError,
} from '../validation/researchIntakeRequest'

function errorResult(error: unknown, requestId: string) {
  if (error instanceof SessionAuthError ||
    error instanceof ResearchIntakeRequestError ||
    error instanceof FormalCompletionError) {
    return errorResponse(error.status, { code: error.code, message: error.message }, requestId)
  }
  return errorResponse(500, {
    code: 'FORMAL_COMPLETION_FAILED',
    message: 'The formal session could not be completed.',
  }, requestId)
}

export async function handleFormalSessionEnd(
  request: Request,
  env: Env,
  requestId: string,
  rawSessionId: string,
) {
  if (request.method !== 'POST') {
    return errorResponse(405, {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Only POST is allowed for this endpoint.',
    }, requestId, { Allow: 'POST' })
  }
  try {
    const sessionId = requireUuid(rawSessionId)
    const input = await parseFormalCompletionRequest(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId, {
      allowedCompletionStatuses: ['in_progress', 'timeout', 'completed'],
    })
    if (input.sessionId !== sessionId) {
      throw new SessionAuthError(
        401,
        'SESSION_UNAUTHORIZED',
        'The formal session could not be authenticated.',
      )
    }
    const data = await completeFormalSession(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}
