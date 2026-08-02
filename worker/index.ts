import type { Env } from './env'
import { errorResponse } from './http/responses'
import { adminErrorResponse } from './http/adminResponses'
import { fetchAsset } from './http/adminAssets'
import { routeRequest } from './router'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await routeRequest(request, env)
    } catch {
      if (
        new URL(request.url).pathname === '/api/admin'
        || new URL(request.url).pathname.startsWith('/api/admin/')
      ) {
        return adminErrorResponse(
          500,
          {
            code: 'INTERNAL_ERROR',
            message: 'The administrator request could not be completed.',
          },
          crypto.randomUUID(),
        )
      }
      if (!new URL(request.url).pathname.startsWith('/api/')) {
        return fetchAsset(request, env.ASSETS)
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
