export type AdminRateLimitPolicy = {
  rateLimitWindowSec: number
  rateLimitMaxFailures: number
  globalRateLimitWindowSec: number
  globalRateLimitMaxFailures: number
}

type AttemptSummary = { count: number; oldest: string | null }

export type AdminRateLimitResult = {
  blocked: boolean
  scope: 'client' | 'global' | null
  retryAfterSec: number
}

export function admitFailedAdminLoginStatement(
  db: D1Database,
  input: {
    attemptId: string
    usernameHash: string
    clientFingerprintHash: string
    requestId: string
    attemptedAt: Date
    policy: AdminRateLimitPolicy
  },
): D1PreparedStatement {
  const localSince = new Date(
    input.attemptedAt.getTime() - input.policy.rateLimitWindowSec * 1000,
  ).toISOString()
  const globalSince = new Date(
    input.attemptedAt.getTime() - input.policy.globalRateLimitWindowSec * 1000,
  ).toISOString()
  return db.prepare(
    `INSERT INTO admin_login_attempts (
      attempt_id, username_hash, client_fingerprint_hash,
      outcome, request_id, attempted_at
    )
    SELECT ?, ?, ?, 'failure', ?, ?
    WHERE (
      SELECT COUNT(*) FROM admin_login_attempts
      WHERE username_hash = ? AND client_fingerprint_hash = ?
        AND outcome IN ('failure', 'blocked') AND attempted_at >= ?
    ) < ?
    AND (
      SELECT COUNT(*) FROM admin_login_attempts
      WHERE username_hash = ? AND outcome IN ('failure', 'blocked')
        AND attempted_at >= ?
    ) < ?`,
  ).bind(
    input.attemptId,
    input.usernameHash,
    input.clientFingerprintHash,
    input.requestId,
    input.attemptedAt.toISOString(),
    input.usernameHash,
    input.clientFingerprintHash,
    localSince,
    input.policy.rateLimitMaxFailures,
    input.usernameHash,
    globalSince,
    input.policy.globalRateLimitMaxFailures,
  )
}

export function admitSuccessfulAdminLoginStatement(
  db: D1Database,
  input: {
    attemptId: string
    usernameHash: string
    clientFingerprintHash: string
    requestId: string
    attemptedAt: Date
    policy: AdminRateLimitPolicy
  },
): D1PreparedStatement {
  const localSince = new Date(
    input.attemptedAt.getTime() - input.policy.rateLimitWindowSec * 1000,
  ).toISOString()
  const globalSince = new Date(
    input.attemptedAt.getTime() - input.policy.globalRateLimitWindowSec * 1000,
  ).toISOString()
  return db.prepare(
    `INSERT INTO admin_login_attempts (
      attempt_id, username_hash, client_fingerprint_hash,
      outcome, request_id, attempted_at
    )
    SELECT ?, ?, ?, 'success', ?, ?
    WHERE (
      SELECT COUNT(*) FROM admin_login_attempts
      WHERE username_hash = ? AND client_fingerprint_hash = ?
        AND outcome IN ('failure', 'blocked') AND attempted_at >= ?
    ) < ?
    AND (
      SELECT COUNT(*) FROM admin_login_attempts
      WHERE username_hash = ? AND outcome IN ('failure', 'blocked')
        AND attempted_at >= ?
    ) < ?`,
  ).bind(
    input.attemptId,
    input.usernameHash,
    input.clientFingerprintHash,
    input.requestId,
    input.attemptedAt.toISOString(),
    input.usernameHash,
    input.clientFingerprintHash,
    localSince,
    input.policy.rateLimitMaxFailures,
    input.usernameHash,
    globalSince,
    input.policy.globalRateLimitMaxFailures,
  )
}

function retryAfter(
  oldest: string | null,
  now: Date,
  windowSec: number,
): number {
  if (!oldest) return windowSec
  return Math.max(1, Math.ceil((Date.parse(oldest) + windowSec * 1000 - now.getTime()) / 1000))
}

export async function checkAdminLoginRateLimit(
  db: D1Database,
  input: {
    usernameHash: string
    clientFingerprintHash: string
    now: Date
    policy: AdminRateLimitPolicy
  },
): Promise<AdminRateLimitResult> {
  const localSince = new Date(
    input.now.getTime() - input.policy.rateLimitWindowSec * 1000,
  ).toISOString()
  const globalSince = new Date(
    input.now.getTime() - input.policy.globalRateLimitWindowSec * 1000,
  ).toISOString()
  const [local, global] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS count, MIN(attempted_at) AS oldest
       FROM admin_login_attempts
       WHERE username_hash = ? AND client_fingerprint_hash = ?
         AND outcome IN ('failure', 'blocked') AND attempted_at >= ?`,
    ).bind(input.usernameHash, input.clientFingerprintHash, localSince)
      .first<AttemptSummary>(),
    db.prepare(
      `SELECT COUNT(*) AS count, MIN(attempted_at) AS oldest
       FROM admin_login_attempts
       WHERE username_hash = ? AND outcome IN ('failure', 'blocked')
         AND attempted_at >= ?`,
    ).bind(input.usernameHash, globalSince).first<AttemptSummary>(),
  ])
  if ((global?.count ?? 0) >= input.policy.globalRateLimitMaxFailures) {
    return {
      blocked: true,
      scope: 'global',
      retryAfterSec: retryAfter(
        global?.oldest ?? null,
        input.now,
        input.policy.globalRateLimitWindowSec,
      ),
    }
  }
  if ((local?.count ?? 0) >= input.policy.rateLimitMaxFailures) {
    return {
      blocked: true,
      scope: 'client',
      retryAfterSec: retryAfter(
        local?.oldest ?? null,
        input.now,
        input.policy.rateLimitWindowSec,
      ),
    }
  }
  return { blocked: false, scope: null, retryAfterSec: 0 }
}

export function adminLoginAttemptStatement(
  db: D1Database,
  input: {
    attemptId?: string
    usernameHash: string
    clientFingerprintHash: string
    outcome: 'success' | 'failure' | 'blocked'
    requestId: string
    attemptedAt: string
  },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_login_attempts (
      attempt_id, username_hash, client_fingerprint_hash,
      outcome, request_id, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.attemptId ?? crypto.randomUUID(),
    input.usernameHash,
    input.clientFingerprintHash,
    input.outcome,
    input.requestId,
    input.attemptedAt,
  )
}
