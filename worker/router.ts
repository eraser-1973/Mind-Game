import type { Env } from './env'
import { errorResponse } from './http/responses'
import { handleHealth } from './routes/health'
import {
  handleStartFormalGame,
  handleT1Rating,
  handleT1StageChoice,
  handleEvidenceUnlock,
} from './routes/formalGame'
import { handleSessions } from './routes/sessions'
import {
  handleConsent,
  handleDemographics,
  handleQuestionnaires,
  handleSessionResume,
} from './routes/researchIntake'
import {
  handleActiveFinalDecision,
  handleSunkCostChoice,
  handleSunkCostShow,
  handleTimeoutFinalDecision,
} from './routes/sunkCostFinal'
import { handleFormalSessionEnd } from './routes/formalCompletion'

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (!url.pathname.startsWith('/api/')) {
    return env.ASSETS.fetch(request)
  }

  const requestId = crypto.randomUUID()

  if (url.pathname === '/api/health') {
    return handleHealth(request, env, requestId)
  }

  if (url.pathname === '/api/sessions') {
    return handleSessions(request, env, requestId)
  }

  if (url.pathname === '/api/consent') {
    return handleConsent(request, env, requestId)
  }

  if (url.pathname === '/api/demographics') {
    return handleDemographics(request, env, requestId)
  }

  if (url.pathname === '/api/questionnaires') {
    return handleQuestionnaires(request, env, requestId)
  }

  if (url.pathname === '/api/ratings') {
    return handleT1Rating(request, env, requestId)
  }

  if (url.pathname === '/api/stage-choices') {
    return handleT1StageChoice(request, env, requestId)
  }

  if (url.pathname === '/api/evidence/unlock') {
    return handleEvidenceUnlock(request, env, requestId)
  }

  if (url.pathname === '/api/sunk-cost/show') {
    return handleSunkCostShow(request, env, requestId)
  }

  if (url.pathname === '/api/sunk-cost/choice') {
    return handleSunkCostChoice(request, env, requestId)
  }

  if (url.pathname === '/api/final-decision') {
    return handleActiveFinalDecision(request, env, requestId)
  }

  if (url.pathname === '/api/final-decision/timeout') {
    return handleTimeoutFinalDecision(request, env, requestId)
  }

  const startMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/start$/)
  if (startMatch) {
    return handleStartFormalGame(request, env, requestId, startMatch[1])
  }

  const resumeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/resume$/)
  if (resumeMatch) {
    return handleSessionResume(request, env, requestId, resumeMatch[1])
  }

  const endMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/end$/)
  if (endMatch) {
    return handleFormalSessionEnd(request, env, requestId, endMatch[1])
  }

  return errorResponse(
    404,
    {
      code: 'NOT_FOUND',
      message: 'The requested API endpoint does not exist.',
    },
    requestId,
  )
}
