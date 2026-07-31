import type { Env } from '../env'
import { IdentityValidationError } from '../domain/identity'
import { serializeSessionCookie } from '../domain/sessionToken'
import { errorResponse, successResponse } from '../http/responses'
import {
  createOrReplayFormalSession,
  SessionCreationError,
} from '../services/sessionCreation'
import {
  parseCreateSessionRequest,
  SessionRequestError,
} from '../validation/sessionRequest'

export async function handleSessions(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(
      405,
      {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST is allowed for this endpoint.',
      },
      requestId,
      { Allow: 'POST' },
    )
  }

  try {
    const input = await parseCreateSessionRequest(request)
    const result = await createOrReplayFormalSession(env.DB, input)
    const cookie = serializeSessionCookie(
      result.token,
      new URL(request.url).protocol === 'https:',
    )

    return successResponse(
      { created: result.created, ...result.data },
      requestId,
      result.created ? 201 : 200,
      { 'Set-Cookie': cookie },
    )
  } catch (error) {
    if (
      error instanceof SessionRequestError ||
      error instanceof IdentityValidationError ||
      error instanceof SessionCreationError
    ) {
      return errorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
      )
    }

    return errorResponse(
      500,
      {
        code: 'SESSION_CREATE_FAILED',
        message: 'The formal session could not be created.',
      },
      requestId,
    )
  }
}
