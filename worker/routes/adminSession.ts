import { AdminAuthError, authenticateAdmin } from '../auth/adminAuth'
import type { Env } from '../env'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import { adminTerminalAuditStatement } from '../services/adminAudit'
import {
  clearAdminCsrfCookie,
  clearAdminSessionCookie,
  generateAdminToken,
  hashAdminToken,
  readCookie,
  serializeAdminCsrfCookie,
} from '../security/adminCookies'
import { constantTimeEqualBytes } from '../security/adminPassword'
import { AdminCsrfError, requireAdminCsrf } from '../security/adminCsrf'
import { AdminOriginError, requireSameAdminOrigin } from '../security/adminOrigin'

function equalHash(left: string, right: string): boolean {
  return constantTimeEqualBytes(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  )
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

function clearedCookieHeaders(request: Request): Headers {
  const secure = secureRequest(request)
  const headers = new Headers()
  headers.append('Set-Cookie', clearAdminSessionCookie(secure))
  headers.append('Set-Cookie', clearAdminCsrfCookie(secure))
  return headers
}

function authError(error: AdminAuthError, requestId: string): Response {
  return adminErrorResponse(
    error.status,
    { code: error.code, message: error.message },
    requestId,
  )
}

export async function handleAdminSession(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'GET') {
    return adminErrorResponse(
      405,
      { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is allowed.' },
      requestId,
      { Allow: 'GET' },
    )
  }
  try {
    const context = await authenticateAdmin(request, env, { requestId })
    if (context.authMode === 'public') {
      const token = generateAdminToken()
      const headers = new Headers()
      headers.append('Set-Cookie', serializeAdminCsrfCookie(token, secureRequest(request)))
      return adminSuccessResponse({
        authenticated: true,
        authMode: 'public',
        username: 'public-admin',
      }, requestId, 200, headers)
    }
    let csrfCookie: string | null = null
    const supplied = readCookie(request, 'mg_admin_csrf')
    const suppliedHash = supplied ? await hashAdminToken(supplied) : null
    if (!suppliedHash || !equalHash(suppliedHash, context.csrfTokenHash)) {
      const token = generateAdminToken()
      const hash = await hashAdminToken(token)
      await env.DB.prepare(
        `UPDATE admin_sessions SET csrf_token_hash = ?
         WHERE admin_session_id = ? AND revoked_at IS NULL`,
      ).bind(hash, context.adminSessionId).run()
      csrfCookie = serializeAdminCsrfCookie(token, secureRequest(request))
    }
    const headers = new Headers()
    if (csrfCookie) headers.append('Set-Cookie', csrfCookie)
    return adminSuccessResponse({
      authenticated: true,
      admin: { username: context.username },
      session: {
        createdAt: context.createdAt,
        lastSeenAt: context.lastSeenAt,
        idleExpiresAt: context.idleExpiresAt,
        absoluteExpiresAt: context.absoluteExpiresAt,
      },
    }, requestId, 200, headers)
  } catch (error) {
    if (error instanceof AdminAuthError) return authError(error, requestId)
    return adminErrorResponse(
      500,
      { code: 'ADMIN_SESSION_FAILED', message: 'The administrator session could not be checked.' },
      requestId,
    )
  }
}

export async function handleAdminLogout(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  if (request.method !== 'POST') {
    return adminErrorResponse(
      405,
      { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed.' },
      requestId,
      { Allow: 'POST' },
    )
  }
  try {
    requireSameAdminOrigin(request)
  } catch (error) {
    if (error instanceof AdminOriginError) {
      return adminErrorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
      )
    }
    throw error
  }
  try {
    const context = await authenticateAdmin(request, env, { requestId })
    await requireAdminCsrf(request, context)
    if (context.authMode === 'public') {
      const headers = new Headers()
      headers.append('Set-Cookie', clearAdminCsrfCookie(secureRequest(request)))
      return adminSuccessResponse(
        { authenticated: false, loggedOut: true },
        requestId,
        200,
        headers,
      )
    }
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE admin_sessions
         SET revoked_at = ?, revoke_reason = 'logout'
         WHERE admin_session_id = ? AND revoked_at IS NULL`,
      ).bind(now, context.adminSessionId),
      adminTerminalAuditStatement(env.DB, {
        adminUserId: context.adminUserId,
        adminSessionId: context.adminSessionId,
        action: 'admin_logout',
        outcome: 'success',
        targetType: 'admin_session',
        targetId: context.adminSessionId,
        requestId,
        clientFingerprintHash: context.clientFingerprintHash,
        metadata: { authPolicyVersion: context.authPolicyVersion },
        createdAt: now,
      }, { revokedAt: now, revokeReason: 'logout' }),
    ])
    return adminSuccessResponse(
      { authenticated: false, loggedOut: true },
      requestId,
      200,
      clearedCookieHeaders(request),
    )
  } catch (error) {
    if (error instanceof AdminAuthError) {
      if (
        error.code === 'ADMIN_SESSION_REVOKED'
        || error.code === 'ADMIN_SESSION_EXPIRED'
      ) {
        return adminSuccessResponse(
          { authenticated: false, loggedOut: true },
          requestId,
          200,
          clearedCookieHeaders(request),
        )
      }
      return adminErrorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
        clearedCookieHeaders(request),
      )
    }
    if (error instanceof AdminCsrfError) {
      return adminErrorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
      )
    }
    return adminErrorResponse(
      500,
      { code: 'ADMIN_LOGOUT_FAILED', message: 'Administrator logout could not be completed.' },
      requestId,
    )
  }
}
