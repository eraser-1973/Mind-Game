import type { Env } from '../env'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import {
  adminAuditForExistingLoginAttemptStatement,
  adminAuditForExistingSessionStatement,
  adminAuditStatement,
  adminTerminalAuditForUserTransitionStatement,
} from '../services/adminAudit'
import {
  clearAdminCsrfCookie,
  clearAdminSessionCookie,
  generateAdminToken,
  hashAdminToken,
  serializeAdminCsrfCookie,
  serializeAdminSessionCookie,
} from '../security/adminCookies'
import {
  normalizeAdminUsername,
  verifyAdminPassword,
  verifyDummyAdminPassword,
} from '../security/adminPassword'
import { deriveClientFingerprint, hashAdminUsername } from '../security/clientFingerprint'
import { AdminOriginError, requireSameAdminOrigin } from '../security/adminOrigin'
import {
  admitFailedAdminLoginStatement,
  admitSuccessfulAdminLoginStatement,
  adminLoginAttemptStatement,
  checkAdminLoginRateLimit,
  type AdminRateLimitPolicy,
} from '../security/adminRateLimit'

type PolicyRow = {
  auth_policy_version: string
  pbkdf2_iterations: number
  session_absolute_sec: number
  session_idle_sec: number
  session_touch_interval_sec: number
  rate_limit_window_sec: number
  rate_limit_max_failures: number
  global_rate_limit_window_sec: number
  global_rate_limit_max_failures: number
}

type AdminUserRow = {
  admin_user_id: string
  username: string
  password_algorithm: 'PBKDF2-SHA256'
  password_iterations: number
  password_salt_base64: string
  password_hash_base64: string
  password_version: number
  auth_policy_version: string
  is_active: number
}

class AdminLoginRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function parseLoginRequest(request: Request): Promise<{
  username: string
  password: string
}> {
  requireSameAdminOrigin(request)
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new AdminLoginRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.')
  }
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > 8192) {
    throw new AdminLoginRequestError(413, 'ADMIN_REQUEST_TOO_LARGE', 'The request is too large.')
  }
  const source = await request.text()
  if (new TextEncoder().encode(source).length > 8192) {
    throw new AdminLoginRequestError(413, 'ADMIN_REQUEST_TOO_LARGE', 'The request is too large.')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new AdminLoginRequestError(400, 'INVALID_ADMIN_REQUEST', 'The request is invalid.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminLoginRequestError(400, 'INVALID_ADMIN_REQUEST', 'The request is invalid.')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 2
    || keys[0] !== 'password'
    || keys[1] !== 'username'
    || typeof record.username !== 'string'
    || typeof record.password !== 'string'
  ) {
    throw new AdminLoginRequestError(400, 'INVALID_ADMIN_REQUEST', 'The request is invalid.')
  }
  return { username: record.username, password: record.password }
}

function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

function clearAdminCookiesHeaders(request: Request): Headers {
  const secure = secureRequest(request)
  const headers = new Headers()
  headers.append('Set-Cookie', clearAdminSessionCookie(secure))
  headers.append('Set-Cookie', clearAdminCsrfCookie(secure))
  return headers
}

export { clearAdminCookiesHeaders }

export async function replaceActiveAdminSession(
  db: D1Database,
  input: {
    adminSessionId: string
    adminUserId: string
    sessionTokenHash: string
    csrfTokenHash: string
    passwordVersion: number
    authPolicyVersion: string
    clientFingerprintHash: string
    userAgentHash: string
    createdAt: string
    idleExpiresAt: string
    absoluteExpiresAt: string
    requestId: string
    loginAttemptId: string
    usernameHash: string
    ratePolicy: AdminRateLimitPolicy
  },
): Promise<{ admitted: boolean; revokedSessionCount: number }> {
  const results = await db.batch([
    admitSuccessfulAdminLoginStatement(db, {
      attemptId: input.loginAttemptId,
      usernameHash: input.usernameHash,
      clientFingerprintHash: input.clientFingerprintHash,
      requestId: input.requestId,
      attemptedAt: new Date(input.createdAt),
      policy: input.ratePolicy,
    }),
      db.prepare(
        `UPDATE admin_sessions
         SET revoked_at = ?, revoke_reason = 'new_login'
         WHERE admin_user_id = ? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM admin_login_attempts WHERE attempt_id = ?
           )`,
      ).bind(input.createdAt, input.adminUserId, input.loginAttemptId),
      adminTerminalAuditForUserTransitionStatement(db, {
        adminUserId: input.adminUserId,
        action: 'admin_session_revoked',
        outcome: 'success',
        targetType: 'admin_session',
        requestId: input.requestId,
        clientFingerprintHash: input.clientFingerprintHash,
        metadata: {
          reason: 'new_login',
          authPolicyVersion: input.authPolicyVersion,
        },
        createdAt: input.createdAt,
      }, { revokedAt: input.createdAt, revokeReason: 'new_login' }),
      db.prepare(
        `INSERT INTO admin_sessions (
          admin_session_id, admin_user_id, session_token_hash, csrf_token_hash,
          password_version, auth_policy_version, client_fingerprint_hash,
          user_agent_hash, created_at, last_seen_at, idle_expires_at,
          absolute_expires_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM admin_login_attempts WHERE attempt_id = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM admin_sessions
          WHERE admin_user_id = ? AND revoked_at IS NULL
        )`,
      ).bind(
        input.adminSessionId,
        input.adminUserId,
        input.sessionTokenHash,
        input.csrfTokenHash,
        input.passwordVersion,
        input.authPolicyVersion,
        input.clientFingerprintHash,
        input.userAgentHash,
        input.createdAt,
        input.createdAt,
        input.idleExpiresAt,
        input.absoluteExpiresAt,
        input.loginAttemptId,
        input.adminUserId,
      ),
      db.prepare(
        `UPDATE admin_users SET last_login_at = ?
         WHERE admin_user_id = ? AND EXISTS (
           SELECT 1 FROM admin_sessions WHERE admin_session_id = ?
         )`,
      ).bind(input.createdAt, input.adminUserId, input.adminSessionId),
      adminAuditForExistingSessionStatement(db, {
        adminUserId: input.adminUserId,
        adminSessionId: input.adminSessionId,
        action: 'admin_login_success',
        outcome: 'success',
        targetType: 'admin_session',
        targetId: input.adminSessionId,
        requestId: input.requestId,
        clientFingerprintHash: input.clientFingerprintHash,
        metadata: {
          authPolicyVersion: input.authPolicyVersion,
        },
        createdAt: input.createdAt,
      }),
  ])
  const admitted = (results[0]?.meta.changes ?? 0) === 1
  const revokedSessionCount = results[1]?.meta.changes ?? 0
  if (admitted && (results[3]?.meta.changes ?? 0) !== 1) {
    throw new Error('Administrator session transition did not create a session.')
  }
  return { admitted, revokedSessionCount }
}

export async function handleAdminLogin(
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
    const input = await parseLoginRequest(request)
    const nowDate = new Date()
    const now = nowDate.toISOString()
    const normalizedUsername = normalizeAdminUsername(input.username)
    const [fingerprint, usernameHash, policy] = await Promise.all([
      deriveClientFingerprint(request),
      hashAdminUsername(normalizedUsername),
      env.DB.prepare(
        `SELECT * FROM admin_auth_policies
         WHERE status = 'published'
         ORDER BY published_at DESC, auth_policy_version DESC LIMIT 1`,
      ).first<PolicyRow>(),
    ])
    if (!policy) throw new Error('Published administrator policy is unavailable.')

    const ratePolicy = {
      rateLimitWindowSec: policy.rate_limit_window_sec,
      rateLimitMaxFailures: policy.rate_limit_max_failures,
      globalRateLimitWindowSec: policy.global_rate_limit_window_sec,
      globalRateLimitMaxFailures: policy.global_rate_limit_max_failures,
    }
    const rate = await checkAdminLoginRateLimit(env.DB, {
      usernameHash,
      clientFingerprintHash: fingerprint.clientFingerprintHash,
      now: nowDate,
      policy: ratePolicy,
    })
    if (rate.blocked) {
      await env.DB.batch([
        adminLoginAttemptStatement(env.DB, {
          usernameHash,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          outcome: 'blocked',
          requestId,
          attemptedAt: now,
        }),
        adminAuditStatement(env.DB, {
          action: 'admin_login_rate_limited',
          outcome: 'blocked',
          requestId,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          metadata: {
            authPolicyVersion: policy.auth_policy_version,
            scope: rate.scope,
            retryAfterSec: rate.retryAfterSec,
          },
          createdAt: now,
        }),
      ])
      return adminErrorResponse(
        429,
        {
          code: 'ADMIN_LOGIN_RATE_LIMITED',
          message: 'Too many administrator login attempts.',
        },
        requestId,
        { 'Retry-After': String(rate.retryAfterSec) },
      )
    }

    const user = await env.DB.prepare(
      `SELECT * FROM admin_users WHERE username_normalized = ?`,
    ).bind(normalizedUsername).first<AdminUserRow>()
    const verified = user
      ? await verifyAdminPassword(input.password, {
          passwordAlgorithm: user.password_algorithm,
          passwordIterations: user.password_iterations,
          passwordSaltBase64: user.password_salt_base64,
          passwordHashBase64: user.password_hash_base64,
        })
      : await verifyDummyAdminPassword(input.password, policy.pbkdf2_iterations)

    if (!user || !verified || user.is_active !== 1) {
      const loginAttemptId = crypto.randomUUID()
      const results = await env.DB.batch([
        admitFailedAdminLoginStatement(env.DB, {
          attemptId: loginAttemptId,
          usernameHash,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          requestId,
          attemptedAt: nowDate,
          policy: ratePolicy,
        }),
        adminAuditForExistingLoginAttemptStatement(env.DB, {
          loginAttemptId,
          adminUserId: user?.admin_user_id ?? null,
          action: 'admin_login_failure',
          outcome: 'failure',
          requestId,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          metadata: { authPolicyVersion: policy.auth_policy_version },
          createdAt: now,
        }),
      ])
      if ((results[0]?.meta.changes ?? 0) !== 1) {
        const limited = await checkAdminLoginRateLimit(env.DB, {
          usernameHash,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          now: nowDate,
          policy: ratePolicy,
        })
        await env.DB.batch([
          adminLoginAttemptStatement(env.DB, {
            usernameHash,
            clientFingerprintHash: fingerprint.clientFingerprintHash,
            outcome: 'blocked',
            requestId,
            attemptedAt: now,
          }),
          adminAuditStatement(env.DB, {
            action: 'admin_login_rate_limited',
            outcome: 'blocked',
            requestId,
            clientFingerprintHash: fingerprint.clientFingerprintHash,
            metadata: {
              authPolicyVersion: policy.auth_policy_version,
              scope: limited.scope,
              retryAfterSec: limited.retryAfterSec,
            },
            createdAt: now,
          }),
        ])
        return adminErrorResponse(
          429,
          { code: 'ADMIN_LOGIN_RATE_LIMITED', message: 'Too many administrator login attempts.' },
          requestId,
          { 'Retry-After': String(limited.retryAfterSec) },
        )
      }
      return adminErrorResponse(
        401,
        {
          code: 'INVALID_ADMIN_CREDENTIALS',
          message: 'The administrator credentials are invalid.',
        },
        requestId,
      )
    }

    const rawSessionToken = generateAdminToken()
    const rawCsrfToken = generateAdminToken()
    const adminSessionId = crypto.randomUUID()
    const [sessionTokenHash, csrfTokenHash] = await Promise.all([
      hashAdminToken(rawSessionToken),
      hashAdminToken(rawCsrfToken),
    ])
    const absoluteExpiresAt = new Date(
      nowDate.getTime() + policy.session_absolute_sec * 1000,
    ).toISOString()
    const idleExpiresAt = new Date(
      nowDate.getTime() + policy.session_idle_sec * 1000,
    ).toISOString()
    const loginAttemptId = crypto.randomUUID()
    const sessionTransition = await replaceActiveAdminSession(env.DB, {
      adminSessionId,
      adminUserId: user.admin_user_id,
      sessionTokenHash,
      csrfTokenHash,
      passwordVersion: user.password_version,
      authPolicyVersion: policy.auth_policy_version,
      clientFingerprintHash: fingerprint.clientFingerprintHash,
      userAgentHash: fingerprint.userAgentHash,
      createdAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      requestId,
      loginAttemptId,
      usernameHash,
      ratePolicy,
    })
    if (!sessionTransition.admitted) {
      const limited = await checkAdminLoginRateLimit(env.DB, {
        usernameHash,
        clientFingerprintHash: fingerprint.clientFingerprintHash,
        now: nowDate,
        policy: ratePolicy,
      })
      await env.DB.batch([
        adminLoginAttemptStatement(env.DB, {
          usernameHash,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          outcome: 'blocked',
          requestId,
          attemptedAt: now,
        }),
        adminAuditStatement(env.DB, {
          action: 'admin_login_rate_limited',
          outcome: 'blocked',
          requestId,
          clientFingerprintHash: fingerprint.clientFingerprintHash,
          metadata: {
            authPolicyVersion: policy.auth_policy_version,
            scope: limited.scope,
            retryAfterSec: limited.retryAfterSec,
          },
          createdAt: now,
        }),
      ])
      return adminErrorResponse(
        429,
        { code: 'ADMIN_LOGIN_RATE_LIMITED', message: 'Too many administrator login attempts.' },
        requestId,
        { 'Retry-After': String(limited.retryAfterSec) },
      )
    }

    const headers = new Headers()
    const secure = secureRequest(request)
    headers.append('Set-Cookie', serializeAdminSessionCookie(rawSessionToken, secure))
    headers.append('Set-Cookie', serializeAdminCsrfCookie(rawCsrfToken, secure))
    return adminSuccessResponse(
      {
        authenticated: true,
        admin: { username: user.username },
        session: {
          createdAt: now,
          absoluteExpiresAt,
          idleTimeoutSec: policy.session_idle_sec,
        },
        authPolicyVersion: policy.auth_policy_version,
      },
      requestId,
      200,
      headers,
    )
  } catch (error) {
    if (error instanceof AdminOriginError || error instanceof AdminLoginRequestError) {
      return adminErrorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
      )
    }
    return adminErrorResponse(
      500,
      { code: 'ADMIN_LOGIN_FAILED', message: 'Administrator login could not be completed.' },
      requestId,
    )
  }
}
