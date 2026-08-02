import { AdminAuthError, authenticateAdmin } from '../auth/adminAuth'
import type { Env } from '../env'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import {
  ADMIN_AUDIT_ACTIONS,
  insertAdminAudit,
  safeAdminAuditMetadata,
  type AdminAuditAction,
  type AdminAuditOutcome,
} from '../services/adminAudit'

type AuditRow = {
  audit_id: string
  action: AdminAuditAction
  outcome: AdminAuditOutcome
  target_type: string | null
  target_id: string | null
  request_id: string
  metadata_json: string
  created_at: string
}

const OUTCOMES = new Set<AdminAuditOutcome>(['success', 'failure', 'blocked'])
const ACTIONS = new Set<string>(ADMIN_AUDIT_ACTIONS)
const QUERY_KEYS = new Set(['limit', 'cursor', 'action', 'outcome'])

class AdminAuditRequestError extends Error {
  readonly status = 400
  readonly code = 'INVALID_ADMIN_AUDIT_QUERY'
}

function encodeCursor(row: AuditRow): string {
  const value = JSON.stringify({ createdAt: row.created_at, auditId: row.audit_id })
  let binary = ''
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function decodeCursor(value: string): { createdAt: string; auditId: string } {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    const parsed = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )) as Record<string, unknown>
    if (
      typeof parsed.createdAt !== 'string'
      || typeof parsed.auditId !== 'string'
      || Number.isNaN(Date.parse(parsed.createdAt))
    ) throw new Error('bad cursor')
    return { createdAt: parsed.createdAt, auditId: parsed.auditId }
  } catch {
    throw new AdminAuditRequestError('The audit cursor is invalid.')
  }
}

export async function handleAdminAuditLogs(
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
    const url = new URL(request.url)
    for (const key of url.searchParams.keys()) {
      if (!QUERY_KEYS.has(key)) throw new AdminAuditRequestError('The audit query is invalid.')
    }
    const limitText = url.searchParams.get('limit') ?? '50'
    if (!/^\d+$/.test(limitText)) throw new AdminAuditRequestError('The audit limit is invalid.')
    const limit = Number(limitText)
    if (limit < 1 || limit > 100) throw new AdminAuditRequestError('The audit limit is invalid.')
    const action = url.searchParams.get('action')
    const outcome = url.searchParams.get('outcome')
    if (action && !ACTIONS.has(action)) throw new AdminAuditRequestError('The audit action is invalid.')
    if (outcome && !OUTCOMES.has(outcome as AdminAuditOutcome)) {
      throw new AdminAuditRequestError('The audit outcome is invalid.')
    }
    const cursorText = url.searchParams.get('cursor')
    const cursor = cursorText ? decodeCursor(cursorText) : null
    const clauses: string[] = []
    const bindings: unknown[] = []
    if (action) { clauses.push('action = ?'); bindings.push(action) }
    if (outcome) { clauses.push('outcome = ?'); bindings.push(outcome) }
    if (cursor) {
      clauses.push('(created_at < ? OR (created_at = ? AND audit_id < ?))')
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.auditId)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const result = await env.DB.prepare(
      `SELECT audit_id, action, outcome, target_type, target_id,
              request_id, metadata_json, created_at
       FROM admin_audit_logs
       ${where}
       ORDER BY created_at DESC, audit_id DESC
       LIMIT ?`,
    ).bind(...bindings, limit).all<AuditRow>()
    const items = result.results.map((row) => ({
      auditId: row.audit_id,
      action: row.action,
      outcome: row.outcome,
      targetType: row.target_type,
      targetId: row.target_id,
      requestId: row.request_id,
      createdAt: row.created_at,
      metadata: safeAdminAuditMetadata(JSON.parse(row.metadata_json) as Record<string, unknown>),
    }))
    const nextCursor = result.results.length === limit
      ? encodeCursor(result.results[result.results.length - 1])
      : null
    await insertAdminAudit(env.DB, {
      adminUserId: context.adminUserId,
      adminSessionId: context.adminSessionId,
      action: 'admin_audit_logs_viewed',
      outcome: 'success',
      targetType: 'admin_audit_log',
      requestId,
      clientFingerprintHash: context.clientFingerprintHash,
      metadata: { limit, action, outcome },
      createdAt: new Date().toISOString(),
    })
    return adminSuccessResponse({ items, nextCursor }, requestId)
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminErrorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
      )
    }
    if (error instanceof AdminAuditRequestError) {
      return adminErrorResponse(
        error.status,
        { code: error.code, message: error.message },
        requestId,
      )
    }
    return adminErrorResponse(
      500,
      { code: 'ADMIN_AUDIT_FAILED', message: 'Administrator audit logs could not be read.' },
      requestId,
    )
  }
}
