import type { Env } from './env'
import { errorResponse } from './http/responses'
import { handleHealth } from './routes/health'
import { handleSessions } from './routes/sessions'

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

  return errorResponse(
    404,
    {
      code: 'NOT_FOUND',
      message: 'The requested API endpoint does not exist.',
    },
    requestId,
  )
}
