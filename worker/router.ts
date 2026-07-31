import type { Env } from './env'
import { errorResponse } from './http/responses'
import { handleHealth } from './routes/health'
import { handleSessions } from './routes/sessions'
import {
  handleConsent,
  handleDemographics,
  handleQuestionnaires,
  handleSessionResume,
} from './routes/researchIntake'

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

  const resumeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/resume$/)
  if (resumeMatch) {
    return handleSessionResume(request, env, requestId, resumeMatch[1])
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
