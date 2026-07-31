import type { Env } from './env'
import { errorResponse } from './http/responses'
import { routeRequest } from './router'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await routeRequest(request, env)
    } catch {
      if (!new URL(request.url).pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(request)
      }

      return errorResponse(
        500,
        {
          code: 'INTERNAL_ERROR',
          message: 'The request could not be completed.',
        },
        crypto.randomUUID(),
      )
    }
  },
} satisfies ExportedHandler<Env>
