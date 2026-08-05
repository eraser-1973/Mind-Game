export const ADMIN_AUDIT_ACTIONS = [
  'admin_provisioned',
  'admin_password_rotated',
  'admin_login_success',
  'admin_login_failure',
  'admin_login_rate_limited',
  'admin_logout',
  'admin_session_revoked',
  'admin_session_idle_expired',
  'admin_session_absolute_expired',
  'admin_audit_logs_viewed',
  'material_set_created',
  'material_set_updated',
  'material_set_validated',
  'material_set_published',
  'point_rule_created',
  'point_rule_updated',
  'point_rule_validated',
  'point_rule_published',
  'sunk_cost_rule_created',
  'sunk_cost_rule_updated',
  'sunk_cost_rule_validated',
  'sunk_cost_rule_published',
  'configuration_set_created',
  'configuration_set_updated',
  'configuration_set_validated',
  'configuration_set_published',
  'configuration_set_activated',
  'configuration_set_rollback_activated',
  'benchmark_set_created',
  'benchmark_set_updated',
  'benchmark_set_validated',
  'benchmark_set_published',
  'norm_set_created',
  'norm_set_updated',
  'norm_set_validated',
  'norm_set_published',
  'reliability_set_created',
  'reliability_set_updated',
  'reliability_set_validated',
  'reliability_set_published',
  'scoring_definition_created',
  'scoring_definition_updated',
  'scoring_definition_validated',
  'scoring_definition_published',
  'research_sessions_viewed',
  'research_data_exported',
  'research_sessions_deleted',
] as const

export type AdminAuditAction = typeof ADMIN_AUDIT_ACTIONS[number]
export type AdminAuditOutcome = 'success' | 'failure' | 'blocked'

const SAFE_METADATA_KEYS = new Set([
  'authPolicyVersion',
  'reason',
  'scope',
  'retryAfterSec',
  'revokedSessionCount',
  'passwordVersion',
  'limit',
  'action',
  'outcome',
  'version',
  'revision',
  'validationStatus',
  'previousActiveConfig',
  'newActiveConfig',
  'contentFingerprint',
  'warningCount',
  'errorCount',
  'sampleSize',
  'metricCount',
  'fingerprint',
  'totalRdiEnabled',
  'deletedCount',
])

export function safeAdminAuditMetadata(
  value: Record<string, unknown> = {},
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue
    if (
      candidate === null
      || typeof candidate === 'string'
      || typeof candidate === 'number'
      || typeof candidate === 'boolean'
    ) result[key] = candidate
  }
  return result
}

export type InsertAdminAuditInput = {
  auditId?: string
  adminUserId?: string | null
  adminSessionId?: string | null
  action: AdminAuditAction
  outcome: AdminAuditOutcome
  targetType?: string | null
  targetId?: string | null
  requestId: string
  clientFingerprintHash?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
}

type AdminTerminalAction = Extract<AdminAuditAction,
  | 'admin_logout'
  | 'admin_session_revoked'
  | 'admin_session_idle_expired'
  | 'admin_session_absolute_expired'
>

type AdminRevokeReason =
  | 'logout'
  | 'new_login'
  | 'idle_expired'
  | 'absolute_expired'
  | 'password_rotated'
  | 'security_revoked'

function auditBindings(input: InsertAdminAuditInput): unknown[] {
  return [
    input.auditId ?? crypto.randomUUID(),
    input.adminUserId ?? null,
    input.adminSessionId ?? null,
    input.action,
    input.outcome,
    input.targetType ?? null,
    input.targetId ?? null,
    input.requestId,
    input.clientFingerprintHash ?? null,
    JSON.stringify(safeAdminAuditMetadata(input.metadata)),
    input.createdAt,
  ]
}

export function adminAuditStatement(
  db: D1Database,
  input: InsertAdminAuditInput,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_audit_logs (
      audit_id, admin_user_id, admin_session_id, action, outcome,
      target_type, target_id, request_id, client_fingerprint_hash,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, json(?), ?)`,
  ).bind(...auditBindings(input))
}

export function adminAuditForExistingSessionStatement(
  db: D1Database,
  input: InsertAdminAuditInput & { adminSessionId: string },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_audit_logs (
      audit_id, admin_user_id, admin_session_id, action, outcome,
      target_type, target_id, request_id, client_fingerprint_hash,
      metadata_json, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, json(?), ?
    FROM admin_sessions
    WHERE admin_session_id = ?`,
  ).bind(...auditBindings(input), input.adminSessionId)
}

export function adminAuditForExistingLoginAttemptStatement(
  db: D1Database,
  input: InsertAdminAuditInput & { loginAttemptId: string },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_audit_logs (
      audit_id, admin_user_id, admin_session_id, action, outcome,
      target_type, target_id, request_id, client_fingerprint_hash,
      metadata_json, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, json(?), ?
    FROM admin_login_attempts
    WHERE attempt_id = ?`,
  ).bind(...auditBindings(input), input.loginAttemptId)
}

export function adminTerminalAuditStatement(
  db: D1Database,
  input: Omit<InsertAdminAuditInput, 'action' | 'adminSessionId'> & {
    action: AdminTerminalAction
    adminSessionId: string
  },
  terminal: { revokedAt: string; revokeReason: AdminRevokeReason },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_audit_logs (
      audit_id, admin_user_id, admin_session_id, action, outcome,
      target_type, target_id, request_id, client_fingerprint_hash,
      metadata_json, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, json(?), ?
    FROM admin_sessions
    WHERE admin_session_id = ? AND revoked_at = ? AND revoke_reason = ?
    ON CONFLICT(admin_session_id, action)
    WHERE admin_session_id IS NOT NULL AND action IN (
      'admin_logout', 'admin_session_revoked',
      'admin_session_idle_expired', 'admin_session_absolute_expired'
    ) DO NOTHING`,
  ).bind(
    ...auditBindings(input),
    input.adminSessionId,
    terminal.revokedAt,
    terminal.revokeReason,
  )
}

export function adminTerminalAuditForUserTransitionStatement(
  db: D1Database,
  input: Omit<InsertAdminAuditInput, 'adminSessionId' | 'targetId'> & {
    adminUserId: string
    action: AdminTerminalAction
  },
  terminal: { revokedAt: string; revokeReason: AdminRevokeReason },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO admin_audit_logs (
      audit_id, admin_user_id, admin_session_id, action, outcome,
      target_type, target_id, request_id, client_fingerprint_hash,
      metadata_json, created_at
    )
    SELECT ?, ?, session.admin_session_id, ?, ?, ?, session.admin_session_id,
           ?, ?, json(?), ?
    FROM admin_sessions AS session
    WHERE session.admin_session_id = (
      SELECT candidate.admin_session_id
      FROM admin_sessions AS candidate
      WHERE candidate.admin_user_id = ?
        AND candidate.revoked_at = ? AND candidate.revoke_reason = ?
      ORDER BY candidate.rowid DESC
      LIMIT 1
    )
    ON CONFLICT(admin_session_id, action)
    WHERE admin_session_id IS NOT NULL AND action IN (
      'admin_logout', 'admin_session_revoked',
      'admin_session_idle_expired', 'admin_session_absolute_expired'
    ) DO NOTHING`,
  ).bind(
    input.auditId ?? crypto.randomUUID(),
    input.adminUserId,
    input.action,
    input.outcome,
    input.targetType ?? null,
    input.requestId,
    input.clientFingerprintHash ?? null,
    JSON.stringify(safeAdminAuditMetadata(input.metadata)),
    input.createdAt,
    input.adminUserId,
    terminal.revokedAt,
    terminal.revokeReason,
  )
}

export async function insertAdminAudit(
  db: D1Database,
  input: InsertAdminAuditInput,
): Promise<void> {
  await adminAuditStatement(db, input).run()
}
