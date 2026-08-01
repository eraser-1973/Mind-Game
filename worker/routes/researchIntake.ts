import { authenticateFormalSession, SessionAuthError } from '../auth/sessionAuth'
import type { Env } from '../env'
import { errorResponse, successResponse } from '../http/responses'
import {
  loadResumeProjection,
  ResearchIntakeError,
  saveConsent,
  saveDemographics,
  saveQuestionnaire,
} from '../services/researchIntake'
import { FormalGameError, loadFormalGameResume } from '../services/formalGame'
import {
  parseConsentRequest,
  parseDemographicsRequest,
  parseQuestionnaireRequest,
  ResearchIntakeRequestError,
  requireUuid,
} from '../validation/researchIntakeRequest'

function knownError(error: unknown): error is
  | SessionAuthError
  | FormalGameError
  | ResearchIntakeError
  | ResearchIntakeRequestError {
  return error instanceof SessionAuthError ||
    error instanceof FormalGameError ||
    error instanceof ResearchIntakeError ||
    error instanceof ResearchIntakeRequestError
}

function errorResult(error: unknown, requestId: string): Response {
  if (knownError(error)) {
    return errorResponse(
      error.status,
      { code: error.code, message: error.message },
      requestId,
    )
  }
  return errorResponse(
    500,
    {
      code: 'RESEARCH_INTAKE_FAILED',
      message: 'The research intake request could not be completed.',
    },
    requestId,
  )
}

function methodNotAllowed(requestId: string, allow: string): Response {
  return errorResponse(
    405,
    { code: 'METHOD_NOT_ALLOWED', message: `Only ${allow} is allowed for this endpoint.` },
    requestId,
    { Allow: allow },
  )
}

export async function handleConsent(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(requestId, 'POST')
  try {
    const input = await parseConsentRequest(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId)
    const data = await saveConsent(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}

export async function handleDemographics(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(requestId, 'POST')
  try {
    const input = await parseDemographicsRequest(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId)
    const data = await saveDemographics(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}

export async function handleQuestionnaires(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(requestId, 'POST')
  try {
    const input = await parseQuestionnaireRequest(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId, {
      allowedCompletionStatuses: input.phase === 'pre'
        ? ['in_progress']
        : ['in_progress', 'timeout'],
    })
    const data = await saveQuestionnaire(env.DB, session, input)
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}

export async function handleSessionResume(
  request: Request,
  env: Env,
  requestId: string,
  rawSessionId: string,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(requestId, 'GET')
  try {
    const sessionId = requireUuid(rawSessionId)
    const session = await authenticateFormalSession(request, env.DB, sessionId, {
      allowedCompletionStatuses: ['in_progress', 'timeout', 'completed'],
    })
    const data = [
      'playing',
      'post_task',
      'task_experience',
      'completion_pending',
      'completed',
    ].includes(session.currentStep)
      ? await loadFormalGameResume(env.DB, session)
      : await loadResumeProjection(env.DB, session)
    return successResponse(data, requestId)
  } catch (error) {
    return errorResult(error, requestId)
  }
}
