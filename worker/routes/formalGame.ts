import { authenticateFormalSession, SessionAuthError } from '../auth/sessionAuth'
import type { Env } from '../env'
import { errorResponse, successResponse } from '../http/responses'
import {
  FormalGameError,
  saveT1Rating,
  saveT1StageChoice,
  startFormalGame,
} from '../services/formalGame'
import {
  parseStartGameRequest,
  parseT1RatingRequest,
  parseT1StageChoiceRequest,
} from '../validation/formalGameRequest'
import { ResearchIntakeRequestError, requireUuid } from '../validation/researchIntakeRequest'

function methodNotAllowed(requestId: string): Response {
  return errorResponse(
    405,
    { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed for this endpoint.' },
    requestId,
    { Allow: 'POST' },
  )
}

function errorResult(error: unknown, requestId: string): Response {
  if (
    error instanceof SessionAuthError ||
    error instanceof FormalGameError ||
    error instanceof ResearchIntakeRequestError
  ) {
    return errorResponse(
      error.status,
      { code: error.code, message: error.message },
      requestId,
    )
  }
  return errorResponse(
    500,
    { code: 'FORMAL_GAME_FAILED', message: 'The formal game request could not be completed.' },
    requestId,
  )
}

export async function handleStartFormalGame(
  request: Request,
  env: Env,
  requestId: string,
  rawSessionId: string,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(requestId)
  try {
    const pathSessionId = requireUuid(rawSessionId)
    const input = await parseStartGameRequest(request)
    if (input.sessionId !== pathSessionId) {
      throw new SessionAuthError(401, 'SESSION_UNAUTHORIZED', 'The formal session could not be authenticated.')
    }
    const session = await authenticateFormalSession(request, env.DB, input.sessionId)
    const data = await startFormalGame(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}

export async function handleT1Rating(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(requestId)
  try {
    const input = await parseT1RatingRequest(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId)
    const data = await saveT1Rating(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}

export async function handleT1StageChoice(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(requestId)
  try {
    const input = await parseT1StageChoiceRequest(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId)
    const data = await saveT1StageChoice(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}
