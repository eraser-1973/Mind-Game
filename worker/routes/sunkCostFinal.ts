import { authenticateFormalSession, SessionAuthError } from '../auth/sessionAuth'
import { FormalGameError } from '../domain/formalGameError'
import type { Env } from '../env'
import { errorResponse, successResponse } from '../http/responses'
import {
  saveActiveFinalDecision,
  saveSunkCostChoice,
  saveTimeoutFinalDecision,
  showSunkCost,
} from '../services/sunkCostFinal'
import { ResearchIntakeRequestError } from '../validation/researchIntakeRequest'
import {
  parseActiveFinalDecisionRequest,
  parseSunkCostChoiceRequest,
  parseSunkCostShowRequest,
  parseTimeoutFinalDecisionRequest,
} from '../validation/sunkCostFinalRequest'

function methodNotAllowed(requestId: string) {
  return errorResponse(405, { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed for this endpoint.' }, requestId, { Allow: 'POST' })
}

function errorResult(error: unknown, requestId: string) {
  if (error instanceof SessionAuthError || error instanceof FormalGameError || error instanceof ResearchIntakeRequestError) {
    return errorResponse(error.status, { code: error.code, message: error.message }, requestId)
  }
  return errorResponse(500, { code: 'STAGE6_FAILED', message: 'The request could not be completed.' }, requestId)
}

async function handle(
  request: Request,
  env: Env,
  requestId: string,
  parser: (request: Request) => Promise<{ sessionId: string }>,
  service: (db: D1Database, session: Awaited<ReturnType<typeof authenticateFormalSession>>, input: never) => Promise<unknown>,
  allowedCompletionStatuses?: readonly string[],
) {
  if (request.method !== 'POST') return methodNotAllowed(requestId)
  try {
    const input = await parser(request)
    const session = await authenticateFormalSession(request, env.DB, input.sessionId, {
      allowedCompletionStatuses,
    })
    const data = await service(env.DB, session, input as never) as { created?: boolean }
    return successResponse(data, requestId, data.created ? 201 : 200)
  } catch (error) {
    return errorResult(error, requestId)
  }
}

export const handleSunkCostShow = (request: Request, env: Env, requestId: string) =>
  handle(request, env, requestId, parseSunkCostShowRequest, showSunkCost as never)

export const handleSunkCostChoice = (request: Request, env: Env, requestId: string) =>
  handle(request, env, requestId, parseSunkCostChoiceRequest, saveSunkCostChoice as never)

export const handleActiveFinalDecision = (request: Request, env: Env, requestId: string) =>
  handle(request, env, requestId, parseActiveFinalDecisionRequest, saveActiveFinalDecision as never)

export const handleTimeoutFinalDecision = (request: Request, env: Env, requestId: string) =>
  handle(request, env, requestId, parseTimeoutFinalDecisionRequest, saveTimeoutFinalDecision as never,
    ['in_progress', 'timeout', 'completed'])
