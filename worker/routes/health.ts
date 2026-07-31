import { readAppMetadata } from '../db/appMetadata'
import type { Env } from '../env'
import { errorResponse, successResponse } from '../http/responses'

export async function handleHealth(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse(
      405,
      {
        code: 'METHOD_NOT_ALLOWED',
        message: 'This endpoint only accepts GET requests.',
      },
      requestId,
      { Allow: 'GET' },
    )
  }

  try {
    const metadata = await readAppMetadata(env.DB)

    return successResponse(
      {
        service: metadata.serviceName,
        database: 'reachable',
        schemaVersion: metadata.schemaVersion,
        timestamp: new Date().toISOString(),
      },
      requestId,
    )
  } catch {
    return errorResponse(
      503,
      {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The service database is not ready.',
      },
      requestId,
    )
  }
}
