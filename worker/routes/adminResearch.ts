import { zipSync, strToU8 } from 'fflate'
import { AdminAuthError, authenticateAdmin, type AdminContext } from '../auth/adminAuth'
import type { Env } from '../env'
import { fingerprintRequest } from '../domain/configurationFingerprint'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import { requireAdminCsrf, AdminCsrfError } from '../security/adminCsrf'
import { AdminOriginError } from '../security/adminOrigin'
import { adminAuditStatement } from '../services/adminAudit'

const STATUS_VALUES = new Set(['in_progress', 'completed', 'timeout', 'quit', 'error'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 64 * 1024

class ResearchRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

type SessionRow = {
  session_id: string; participant_id: string; completion_status: string; current_step: string
  started_at: string | null; ended_at: string | null; created_at: string; final_submit_mode: string
  task_version: string; material_version: string; config_set_id: string; error_count: number
  duplicate_student_id: number; duplicate_phone: number; full_name: string | null; student_id: string | null; phone: string | null
}

function maskPhone(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, '')
  return normalized.length <= 4 ? '****' : `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`
}

function maskIdentity(row: Pick<SessionRow, 'full_name' | 'student_id' | 'phone'>) {
  return {
    name: row.full_name ? `${row.full_name.slice(0, 1)}*` : null,
    studentId: row.student_id ? `${row.student_id.slice(0, 2)}***` : null,
    phone: maskPhone(row.phone),
  }
}

function qualityFlags(row: Pick<SessionRow, 'error_count' | 'duplicate_student_id' | 'duplicate_phone' | 'completion_status'>): string[] {
  const flags: string[] = []
  if (row.error_count > 0) flags.push('client_error_recorded')
  if (row.duplicate_student_id === 1) flags.push('duplicate_student_id')
  if (row.duplicate_phone === 1) flags.push('duplicate_phone')
  if (row.completion_status === 'error') flags.push('technical_error')
  if (row.completion_status === 'in_progress') flags.push('incomplete')
  return flags
}

function encodeCursor(row: SessionRow): string {
  return btoa(JSON.stringify({ createdAt: row.created_at, sessionId: row.session_id }))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function decodeCursor(value: string): { createdAt: string; sessionId: string } {
  try {
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='))
    const data = JSON.parse(decoded) as Record<string, unknown>
    if (typeof data.createdAt !== 'string' || !UUID.test(String(data.sessionId)) || Number.isNaN(Date.parse(data.createdAt))) throw new Error('invalid')
    return { createdAt: data.createdAt, sessionId: String(data.sessionId) }
  } catch { throw new ResearchRequestError(400, 'RESEARCH_CURSOR_INVALID', 'The research cursor is invalid.') }
}

type ResearchFilter = { status: string | null; startedFrom: string | null; startedTo: string | null }

function dateValue(value: string | null, field: string): string | null {
  if (value === null) return null
  if (Number.isNaN(Date.parse(value))) throw new ResearchRequestError(400, 'RESEARCH_FILTER_INVALID', `${field} must be an ISO date.`)
  return value
}

function parseFilter(source: URLSearchParams | Record<string, unknown>): ResearchFilter {
  const get = (key: string): unknown => source instanceof URLSearchParams ? source.get(key) : source[key]
  const statusValue = get('status')
  const status = statusValue === null || statusValue === undefined || statusValue === '' ? null : String(statusValue)
  if (status !== null && !STATUS_VALUES.has(status)) throw new ResearchRequestError(400, 'RESEARCH_FILTER_INVALID', 'The session status is invalid.')
  const startedFromValue = get('startedFrom')
  const startedToValue = get('startedTo')
  const startedFrom = dateValue(startedFromValue === null || startedFromValue === undefined || startedFromValue === '' ? null : String(startedFromValue), 'startedFrom')
  const startedTo = dateValue(startedToValue === null || startedToValue === undefined || startedToValue === '' ? null : String(startedToValue), 'startedTo')
  if (startedFrom && startedTo && Date.parse(startedFrom) > Date.parse(startedTo)) throw new ResearchRequestError(400, 'RESEARCH_FILTER_INVALID', 'startedFrom must precede startedTo.')
  return { status, startedFrom, startedTo }
}

function filteredWhere(filter: ResearchFilter, alias = 's'): { sql: string; values: unknown[] } {
  const clauses: string[] = []
  const values: unknown[] = []
  if (filter.status) { clauses.push(`${alias}.completion_status=?`); values.push(filter.status) }
  if (filter.startedFrom) { clauses.push(`COALESCE(${alias}.started_at,${alias}.created_at)>=?`); values.push(filter.startedFrom) }
  if (filter.startedTo) { clauses.push(`COALESCE(${alias}.started_at,${alias}.created_at)<=?`); values.push(filter.startedTo) }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) throw new ResearchRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Research writes require application/json.')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new ResearchRequestError(413, 'RESEARCH_REQUEST_TOO_LARGE', 'The research request is too large.')
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch { throw new ResearchRequestError(400, 'RESEARCH_REQUEST_INVALID', 'The research request must be a JSON object.') }
}

async function writeContext(request: Request, env: Env, requestId: string) {
  const admin = await authenticateAdmin(request, env, { requestId })
  await requireAdminCsrf(request, admin)
  const body = await readJson(request)
  const key = request.headers.get('Idempotency-Key')
  if (!key || !UUID.test(key)) throw new ResearchRequestError(400, 'IDEMPOTENCY_KEY_INVALID', 'A UUID Idempotency-Key is required.')
  return { admin, body, key, requestHash: await fingerprintRequest({ method: request.method, path: new URL(request.url).pathname, body }) }
}

async function replayReceipt(db: D1Database, key: string, requestHash: string) {
  const receipt = await db.prepare(`SELECT request_hash,response_status,response_json FROM admin_operation_receipts WHERE idempotency_key=?`).bind(key)
    .first<{ request_hash: string; response_status: number; response_json: string }>()
  if (!receipt) return null
  if (receipt.request_hash !== requestHash) throw new ResearchRequestError(409, 'IDEMPOTENCY_KEY_REUSED', 'The idempotency key belongs to a different request.')
  return { status: receipt.response_status, data: JSON.parse(receipt.response_json) as Record<string, unknown> }
}

async function tombstoneHash(secret: string | undefined, sessionId: string): Promise<string> {
  if (!secret || secret.length < 16) throw new ResearchRequestError(503, 'TOMBSTONE_SECRET_UNAVAILABLE', 'Deletion is temporarily unavailable.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`mind-game/session/v1:${sessionId}`))
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(protectedText) ? `"${protectedText.replaceAll('"', '""')}"` : protectedText
}

function csv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const headers = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
  return `${headers.join(',')}\r\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')).join('\r\n')}\r\n`
}

async function selectRows(db: D1Database, sql: string, values: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const result = await db.prepare(sql).bind(...values).all<Record<string, unknown>>()
  return result.results
}

async function exportZip(db: D1Database, filter: ResearchFilter): Promise<Uint8Array> {
  const clause = filteredWhere(filter)
  const sessions = await selectRows(db, `SELECT s.session_id AS sessionId,s.participant_id AS participantId,s.completion_status AS status,s.current_step AS currentStep,s.started_at AS startedAt,s.ended_at AS endedAt,s.final_submit_mode AS completionType,s.task_version AS taskVersion,s.material_version AS materialVersion,s.config_set_id AS configVersion,i.full_name AS fullName,i.student_id AS studentId,i.phone AS phone FROM sessions s LEFT JOIN participant_identity i ON i.participant_id=s.participant_id ${clause.sql} ORDER BY s.created_at,s.session_id`, clause.values)
  const ids = sessions.map((row) => String(row.sessionId))
  const placeholders = ids.map(() => '?').join(',') || "''"
  const sessionRows = sessions.map((row) => ({ ...row, phone: maskPhone(row.phone as string | null) }))
  const scoped = async (table: string, columns = '*', alias = 'session_id') => selectRows(db, `SELECT ${columns} FROM ${table} WHERE ${alias} IN (${placeholders})`, ids)
  const identity = await selectRows(db, `SELECT p.participant_id AS participantId,i.full_name AS fullName,i.student_id AS studentId,i.phone AS phone FROM participants p JOIN participant_identity i ON i.participant_id=p.participant_id WHERE p.participant_id IN (${ids.map(() => '?').join(',') || "''"})`, sessions.map((row) => String(row.participantId)))
  const answers = await selectRows(db, `SELECT q.session_id AS sessionId,q.phase,q.instrument_version AS instrumentVersion,a.item_id AS itemId,a.value,a.touched,a.answered_at AS answeredAt FROM questionnaire_submissions q JOIN questionnaire_answers a ON a.submission_id=q.submission_id WHERE q.session_id IN (${placeholders})`, ids)
  const evidence = await selectRows(db, `SELECT e.session_id AS sessionId,e.event_id AS eventId,e.candidate_id AS candidateId,e.evidence_level AS evidenceLevel,e.evidence_ids_json AS evidenceIds,e.points_before AS pointsBefore,e.points_cost AS pointsCost,e.points_after AS pointsAfter,e.contains_key_risk AS containsKeyRisk,e.server_at AS serverAt,e.sequence_no AS sequenceNo FROM evidence_events e WHERE e.session_id IN (${placeholders})`, ids)
  const derived = await selectRows(db, `SELECT r.session_id AS sessionId,r.scoring_run_id AS runId,v.metric_code AS metricCode,v.numeric_value AS numericValue,v.calculation_status AS calculationStatus FROM scoring_runs r JOIN derived_metric_values v ON v.scoring_run_id=r.scoring_run_id WHERE r.session_id IN (${placeholders})`, ids)
  const files: Record<string, Uint8Array> = {
    'sessions.csv': strToU8(csv(sessionRows)),
    'participant_identity.csv': strToU8(csv(identity.map((row) => ({ ...row, phone: maskPhone(row.phone as string | null) })))),
    'consent_records.csv': strToU8(csv(await scoped('consent_records'))),
    'demographics.csv': strToU8(csv(await scoped('demographic_revisions'))),
    'questionnaires.csv': strToU8(csv(answers)),
    'stage_ratings.csv': strToU8(csv(await scoped('stage_ratings'))),
    'stage_choices.csv': strToU8(csv(await scoped('stage_choices'))),
    'evidence_unlocks.csv': strToU8(csv(evidence)),
    'game_events.csv': strToU8(csv(await scoped('game_events'))),
    'point_ledger.csv': strToU8(csv(await scoped('point_ledger'))),
    'final_decisions.csv': strToU8(csv(await scoped('final_decisions'))),
    'completion_records.csv': strToU8(csv(await scoped('completion_records'))),
    'derived_metrics.csv': strToU8(csv(derived)),
  }
  return zipSync(files, { level: 6 })
}

async function listSessions(request: Request, env: Env, requestId: string): Promise<Response> {
  const admin = await authenticateAdmin(request, env, { requestId })
  const url = new URL(request.url)
  for (const key of url.searchParams.keys()) if (!['pageSize', 'cursor', 'status', 'startedFrom', 'startedTo'].includes(key)) throw new ResearchRequestError(400, 'RESEARCH_FILTER_INVALID', 'The research query is invalid.')
  const sizeText = url.searchParams.get('pageSize') ?? '50'
  if (!/^\d+$/.test(sizeText) || Number(sizeText) < 1 || Number(sizeText) > 100) throw new ResearchRequestError(400, 'RESEARCH_PAGE_SIZE_INVALID', 'pageSize must be between 1 and 100.')
  const filter = parseFilter(url.searchParams)
  const cursor = url.searchParams.get('cursor') ? decodeCursor(url.searchParams.get('cursor')!) : null
  const where = filteredWhere(filter)
  const clauses = where.sql ? [where.sql.slice(6)] : []
  const values = [...where.values]
  if (cursor) { clauses.push('(s.created_at > ? OR (s.created_at = ? AND s.session_id > ?))'); values.push(cursor.createdAt, cursor.createdAt, cursor.sessionId) }
  const result = await env.DB.prepare(`SELECT s.session_id,s.participant_id,s.completion_status,s.current_step,s.started_at,s.ended_at,s.created_at,s.final_submit_mode,s.task_version,s.material_version,s.config_set_id,s.error_count,s.duplicate_student_id,s.duplicate_phone,i.full_name,i.student_id,i.phone FROM sessions s LEFT JOIN participant_identity i ON i.participant_id=s.participant_id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY s.created_at ASC,s.session_id ASC LIMIT ?`).bind(...values, Number(sizeText)).all<SessionRow>()
  await env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`).bind(crypto.randomUUID(), admin.adminUserId, admin.adminSessionId, 'research_sessions_viewed', 'success', 'research_sessions', null, requestId, admin.clientFingerprintHash, JSON.stringify({ limit: Number(sizeText), authMode: admin.authMode }), new Date().toISOString()).run()
  const items = result.results.map((row) => ({ sessionId: row.session_id, participantId: row.participant_id, identity: maskIdentity(row), status: row.completion_status, currentStep: row.current_step, startedAt: row.started_at, endedAt: row.ended_at, completionType: row.final_submit_mode, taskVersion: row.task_version, materialVersion: row.material_version, configVersion: row.config_set_id, qualityFlags: qualityFlags(row) }))
  return adminSuccessResponse({ items, nextCursor: result.results.length === Number(sizeText) ? encodeCursor(result.results[result.results.length - 1]) : null }, requestId)
}

async function sessionDetail(request: Request, env: Env, requestId: string, sessionId: string): Promise<Response> {
  const admin = await authenticateAdmin(request, env, { requestId })
  if (!UUID.test(sessionId)) throw new ResearchRequestError(400, 'SESSION_ID_INVALID', 'The session ID is invalid.')
  const row = await env.DB.prepare(`SELECT s.session_id,s.participant_id,s.completion_status,s.current_step,s.started_at,s.ended_at,s.created_at,s.final_submit_mode,s.task_version,s.material_version,s.config_set_id,s.error_count,s.duplicate_student_id,s.duplicate_phone,i.full_name,i.student_id,i.phone FROM sessions s LEFT JOIN participant_identity i ON i.participant_id=s.participant_id WHERE s.session_id=?`).bind(sessionId).first<SessionRow>()
  if (!row) throw new ResearchRequestError(404, 'SESSION_NOT_FOUND', 'The session does not exist.')
  await env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`).bind(crypto.randomUUID(), admin.adminUserId, admin.adminSessionId, 'research_sessions_viewed', 'success', 'research_session', null, requestId, admin.clientFingerprintHash, JSON.stringify({ authMode: admin.authMode }), new Date().toISOString()).run()
  return adminSuccessResponse({ sessionId: row.session_id, participantId: row.participant_id, identity: maskIdentity(row), status: row.completion_status, currentStep: row.current_step, startedAt: row.started_at, endedAt: row.ended_at, completionType: row.final_submit_mode, taskVersion: row.task_version, materialVersion: row.material_version, configVersion: row.config_set_id, qualityFlags: qualityFlags(row) }, requestId)
}

async function exportResearch(request: Request, env: Env, requestId: string): Promise<Response> {
  const admin = await authenticateAdmin(request, env, { requestId }); await requireAdminCsrf(request, admin)
  const body = await readJson(request); if (Object.keys(body).some((key) => !['status', 'startedFrom', 'startedTo'].includes(key))) throw new ResearchRequestError(400, 'RESEARCH_REQUEST_INVALID', 'The export request contains unknown fields.')
  const filter = parseFilter(body); const data = await exportZip(env.DB, filter); const now = new Date().toISOString()
  await env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`).bind(crypto.randomUUID(), admin.adminUserId, admin.adminSessionId, 'research_data_exported', 'success', 'research_export', null, requestId, admin.clientFingerprintHash, JSON.stringify({ scope: filter.status ?? 'all', authMode: admin.authMode }), now).run()
  return new Response(data, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="mind-game-research-${now.replaceAll(/[:.]/g, '-')}.zip"`, 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' } })
}

async function deleteSessions(request: Request, env: Env, requestId: string, pathSessionId: string | null): Promise<Response> {
  const context = await writeContext(request, env, requestId)
  const replay = await replayReceipt(env.DB, context.key, context.requestHash)
  if (replay) return adminSuccessResponse(replay.data, requestId, replay.status)
  const allowed = pathSessionId === null ? ['sessionIds', 'confirmation', 'reasonCode'] : ['confirmation', 'reasonCode']
  if (Object.keys(context.body).some((key) => !allowed.includes(key))) throw new ResearchRequestError(400, 'RESEARCH_REQUEST_INVALID', 'The deletion request contains unknown fields.')
  const requestedIds = pathSessionId === null && Array.isArray(context.body.sessionIds)
    ? context.body.sessionIds.filter((value): value is string => typeof value === 'string')
    : pathSessionId === null ? [] : [pathSessionId]
  if (!Array.isArray(requestedIds) || requestedIds.length < 1 || requestedIds.length > 100 || requestedIds.some((id) => !UUID.test(id)) || new Set(requestedIds).size !== requestedIds.length) throw new ResearchRequestError(400, 'SESSION_IDS_INVALID', 'One to one hundred unique session IDs are required.')
  const confirmation = context.body.confirmation
  const expected = requestedIds.length === 1 ? `DELETE SESSION ${requestedIds[0]}` : `DELETE ${requestedIds.length} SESSIONS`
  if (confirmation !== expected) throw new ResearchRequestError(400, 'DELETE_CONFIRMATION_INVALID', 'The deletion confirmation does not match.')
  if (typeof context.body.reasonCode !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(context.body.reasonCode)) throw new ResearchRequestError(400, 'DELETE_REASON_INVALID', 'A safe deletion reason code is required.')
  const rows = await env.DB.prepare(`SELECT session_id,participant_id FROM sessions WHERE session_id IN (${requestedIds.map(() => '?').join(',')})`).bind(...requestedIds).all<{ session_id: string; participant_id: string }>()
  if (rows.results.length !== requestedIds.length) throw new ResearchRequestError(404, 'SESSION_NOT_FOUND', 'One or more sessions do not exist.')
  const now = new Date().toISOString(); const hashes = await Promise.all(rows.results.map((row) => tombstoneHash(env.TOMBSTONE_HASH_SECRET, row.session_id))); const participants = [...new Set(rows.results.map((row) => row.participant_id))]
  const scope = requestedIds.length === 1 ? 'single_session' : 'bulk_sessions'; const responseData = { deletedCount: requestedIds.length, deletedAt: now }
  const statements: D1PreparedStatement[] = []
  for (const hash of hashes) statements.push(env.DB.prepare(`INSERT INTO deletion_tombstones (tombstone_id,entity_type,deleted_entity_hash,deletion_scope,deleted_by_admin_user_id,deletion_request_id,deleted_at,reason_code) VALUES (?,'session',?,?,?,?,?,?)`).bind(crypto.randomUUID(), hash, scope, context.admin.adminUserId, requestId, now, context.body.reasonCode))
  statements.push(env.DB.prepare(`DELETE FROM sessions WHERE session_id IN (${requestedIds.map(() => '?').join(',')})`).bind(...requestedIds))
  statements.push(env.DB.prepare(`DELETE FROM participant_identity WHERE participant_id IN (${participants.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.participant_id=participant_identity.participant_id)`).bind(...participants))
  statements.push(env.DB.prepare(`DELETE FROM participants WHERE participant_id IN (${participants.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.participant_id=participants.participant_id)`).bind(...participants))
  statements.push(adminAuditStatement(env.DB, { adminUserId: context.admin.adminUserId, adminSessionId: context.admin.adminSessionId, action: 'research_sessions_deleted', outcome: 'success', targetType: 'research_sessions', targetId: null, requestId, clientFingerprintHash: context.admin.clientFingerprintHash, metadata: { scope, metricCount: requestedIds.length, authMode: context.admin.authMode }, createdAt: now }))
  statements.push(env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) VALUES (?,?,?,?,?,?,200,json(?),?)`).bind(context.key, context.admin.adminUserId, 'research_sessions_deleted', 'research_sessions', null, context.requestHash, JSON.stringify(responseData), now))
  try { await env.DB.batch(statements) } catch {
    const after = await replayReceipt(env.DB, context.key, context.requestHash); if (after) return adminSuccessResponse(after.data, requestId, after.status)
    throw new ResearchRequestError(409, 'RESEARCH_DELETE_CONFLICT', 'The requested sessions could not be deleted.')
  }
  return adminSuccessResponse(responseData, requestId)
}

export async function handleAdminResearch(request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === '/api/admin/research/sessions') return await listSessions(request, env, requestId)
    const detail = path.match(/^\/api\/admin\/research\/sessions\/([^/]+)$/)
    if (request.method === 'GET' && detail) return await sessionDetail(request, env, requestId, detail[1])
    if (request.method === 'POST' && path === '/api/admin/research/exports') return await exportResearch(request, env, requestId)
    if (request.method === 'DELETE' && detail) return await deleteSessions(request, env, requestId, detail[1])
    if (request.method === 'POST' && path === '/api/admin/research/sessions/bulk-delete') return await deleteSessions(request, env, requestId, null)
    return adminErrorResponse(404, { code: 'NOT_FOUND', message: 'The requested research endpoint does not exist.' }, requestId)
  } catch (error) {
    if (error instanceof AdminAuthError || error instanceof AdminCsrfError || error instanceof AdminOriginError || error instanceof ResearchRequestError) return adminErrorResponse(error.status, { code: error.code, message: error.message }, requestId)
    return adminErrorResponse(500, { code: 'RESEARCH_ADMIN_FAILED', message: 'The research administrator request could not be completed.' }, requestId)
  }
}
