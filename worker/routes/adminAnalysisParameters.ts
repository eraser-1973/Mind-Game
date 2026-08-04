import { AdminAuthError, authenticateAdmin, type AdminContext } from '../auth/adminAuth'
import type { Env } from '../env'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import { fingerprintRequest } from '../domain/configurationFingerprint'
import { fingerprintNormContent, fingerprintReliabilityContent, fingerprintScoringDefinitionContent } from '../domain/analysisFingerprint'
import { AdminCsrfError, requireAdminCsrf } from '../security/adminCsrf'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VERSION = /^[A-Za-z0-9._-]{3,64}$/
const MAX_BODY_BYTES = 262_144

class ParameterError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

type WriteContext = {
  admin: AdminContext
  key: string
  requestHash: string
  body: Record<string, unknown>
  replay: { status: number; data: unknown } | null
}

function fail(status: number, code: string, message: string): never {
  throw new ParameterError(status, code, message)
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'ANALYSIS_PARAMETER_REQUEST_INVALID', 'The request must be a JSON object.')
  return value as Record<string, unknown>
}

function rejectUnknown(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).some((field) => !fields.includes(field))) fail(400, 'ANALYSIS_PARAMETER_REQUEST_INVALID', 'The request contains unknown fields.')
}

function requireVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || !VERSION.test(value)) fail(400, 'ANALYSIS_PARAMETER_REQUEST_INVALID', `${field} must be a 3-64 character version identifier.`)
  return value
}

async function writeContext(request: Request, env: Env, requestId: string): Promise<WriteContext> {
  const admin = await authenticateAdmin(request, env, { requestId })
  await requireAdminCsrf(request, admin)
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Analysis writes require application/json.')
  const key = request.headers.get('Idempotency-Key') ?? ''
  if (!UUID.test(key)) fail(400, 'IDEMPOTENCY_KEY_INVALID', 'A UUID Idempotency-Key is required.')
  const source = await request.text()
  if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) fail(413, 'ANALYSIS_PARAMETER_REQUEST_TOO_LARGE', 'The request is too large.')
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { fail(400, 'ANALYSIS_PARAMETER_REQUEST_INVALID', 'The request must contain valid JSON.') }
  const body = requireObject(parsed)
  const requestHash = await fingerprintRequest({ method: request.method, path: new URL(request.url).pathname, body })
  const receipt = await env.DB.prepare(`SELECT admin_user_id,request_hash,response_status,response_json FROM admin_operation_receipts WHERE idempotency_key=?`)
    .bind(key).first<{ admin_user_id: string; request_hash: string; response_status: number; response_json: string }>()
  if (receipt) {
    if (receipt.admin_user_id !== admin.adminUserId || receipt.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was already used for a different request.')
    return { admin, key, requestHash, body, replay: { status: receipt.response_status, data: JSON.parse(receipt.response_json) } }
  }
  return { admin, key, requestHash, body, replay: null }
}

async function createNorm(request: Request, env: Env, requestId: string): Promise<Response> {
  const context = await writeContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['version', 'displayName', 'scoringVersion', 'sourceType', 'cloneFrom'])
  const version = requireVersion(context.body.version, 'version')
  const scoringVersion = requireVersion(context.body.scoringVersion, 'scoringVersion')
  if (typeof context.body.displayName !== 'string' || !context.body.displayName.trim()) fail(400, 'ANALYSIS_PARAMETER_REQUEST_INVALID', 'displayName is required.')
  if (context.body.sourceType !== 'manual_parameters' && context.body.sourceType !== 'external_analysis') fail(400, 'NORM_SOURCE_TYPE_INVALID', 'sourceType is invalid.')
  const scoring = await env.DB.prepare(`SELECT status FROM scoring_definitions WHERE scoring_version=?`).bind(scoringVersion).first<{ status: string }>()
  if (!scoring || scoring.status !== 'published') fail(409, 'SCORING_VERSION_NOT_PUBLISHED', 'Norm drafts require a published scoring definition.')
  const cloneFrom = context.body.cloneFrom === undefined ? null : requireVersion(context.body.cloneFrom, 'cloneFrom')
  if (!cloneFrom && context.body.sourceType !== 'manual_parameters') fail(400, 'NORM_SOURCE_TYPE_INVALID', 'An empty norm draft must use manual_parameters.')
  const source = cloneFrom ? await normHeader(env.DB, cloneFrom) : null
  if (cloneFrom && (!source || source.status !== 'published' || source.scoring_version !== scoringVersion)) fail(409, 'NORM_CLONE_SOURCE_INVALID', 'The clone source must be a compatible published norm.')
  const now = new Date().toISOString()
  const data = { version, displayName: context.body.displayName.trim(), scoringVersion, sourceType: context.body.sourceType, sourceVersion: cloneFrom, status: 'draft', revision: 1, validationStatus: 'not_validated', sampleSize: source?.sample_size ?? 0 }
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO norm_sets (norm_version,scoring_version,status,sample_size,population_note,created_at,published_at,display_name,source_norm_version,revision_no,validation_status,validation_report_json,content_fingerprint,created_by_admin_user_id,updated_by_admin_user_id,updated_at,validated_at,source_type,write_token)
        VALUES (?,?,'draft',?,?,?,NULL,?,?,1,'not_validated',json('{"errors":[],"warnings":[]}'),NULL,?,?,?,NULL,?,?)`)
        .bind(version, scoringVersion, source?.sample_size ?? 0, source?.population_note ?? null, now, data.displayName, cloneFrom, context.admin.adminUserId, context.admin.adminUserId, now, context.body.sourceType, context.key),
      ...(cloneFrom ? [env.DB.prepare(`INSERT INTO norm_metric_parameters (norm_version,metric_code,mean_value,sd_value,created_at)
        SELECT ?,metric_code,mean_value,sd_value,? FROM norm_metric_parameters WHERE norm_version=?`).bind(version, now, cloneFrom)] : []),
      env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`)
        .bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'norm_set_created', 'success', 'norm_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: 1, validationStatus: 'not_validated', sampleSize: 0, metricCount: 0, warningCount: 0, errorCount: 0 }), now),
      env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at)
        VALUES (?,?,?,?,?,?,201,json(?),?)`)
        .bind(context.key, context.admin.adminUserId, 'norm_set_created', 'norm_set', version, context.requestHash, JSON.stringify(data), now),
    ])
  } catch {
    const receipt = await env.DB.prepare(`SELECT request_hash,response_status,response_json FROM admin_operation_receipts WHERE idempotency_key=?`).bind(context.key).first<{ request_hash: string; response_status: number; response_json: string }>()
    if (receipt?.request_hash === context.requestHash) return adminSuccessResponse(JSON.parse(receipt.response_json), requestId, receipt.response_status)
    fail(409, 'NORM_CREATE_CONFLICT', 'The norm version already exists or could not be created.')
  }
  return adminSuccessResponse(data, requestId, 201)
}

async function readAdmin(request: Request, env: Env, requestId: string): Promise<void> {
  await authenticateAdmin(request, env, { requestId })
}

async function listNorms(request: Request, env: Env, requestId: string): Promise<Response> {
  await readAdmin(request, env, requestId)
  const rows = await env.DB.prepare(`SELECT norm_version,display_name,scoring_version,source_type,status,revision_no,validation_status,sample_size,published_at FROM norm_sets ORDER BY created_at DESC,norm_version`).all<Record<string, unknown>>()
  return adminSuccessResponse({ items: rows.results.map((row) => ({ version: row.norm_version, displayName: row.display_name, scoringVersion: row.scoring_version, sourceType: row.source_type, status: row.status, revision: row.revision_no, validationStatus: row.validation_status, sampleSize: row.sample_size, publishedAt: row.published_at })) }, requestId)
}
async function getNorm(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  await readAdmin(request, env, requestId); const current = await normHeader(env.DB, version); if (!current) fail(404, 'NORM_NOT_FOUND', 'The norm set does not exist.'); const document = await loadNorm(env.DB, current)
  return adminSuccessResponse({ version, displayName: current.display_name, scoringVersion: current.scoring_version, sourceType: current.source_type, status: current.status, revision: current.revision_no, validationStatus: current.validation_status, validationReport: JSON.parse(current.validation_report_json), fingerprint: current.content_fingerprint, sampleSize: current.sample_size, populationNote: current.population_note, parameters: document.parameters }, requestId)
}
async function listReliability(request: Request, env: Env, requestId: string): Promise<Response> { await readAdmin(request, env, requestId); const rows = await env.DB.prepare(`SELECT reliability_version,display_name,scoring_version,status,revision_no,validation_status,sample_size,published_at FROM reliability_parameters ORDER BY created_at DESC,reliability_version`).all<Record<string, unknown>>(); return adminSuccessResponse({ items: rows.results.map((row) => ({ version: row.reliability_version, displayName: row.display_name, scoringVersion: row.scoring_version, status: row.status, revision: row.revision_no, validationStatus: row.validation_status, sampleSize: row.sample_size, publishedAt: row.published_at })) }, requestId) }
async function getReliability(request: Request, env: Env, requestId: string, version: string): Promise<Response> { await readAdmin(request, env, requestId); const current = await reliabilityHeader(env.DB, version); if (!current) fail(404, 'RELIABILITY_NOT_FOUND', 'The reliability set does not exist.'); return adminSuccessResponse({ version, displayName: current.display_name, scoringVersion: current.scoring_version, metricCode: current.metric_code, sd: current.sd_value, reliability: current.reliability_value, status: current.status, revision: current.revision_no, validationStatus: current.validation_status, sampleSize: current.sample_size, populationNote: current.population_note, fingerprint: current.content_fingerprint }, requestId) }
async function listScoring(request: Request, env: Env, requestId: string): Promise<Response> { await readAdmin(request, env, requestId); const rows = await env.DB.prepare(`SELECT scoring_version,display_name,status,revision_no,validation_status,total_rdi_enabled,level_enabled,published_at FROM scoring_definitions ORDER BY created_at DESC,scoring_version`).all<Record<string, unknown>>(); return adminSuccessResponse({ items: rows.results.map((row) => ({ version: row.scoring_version, displayName: row.display_name, status: row.status, revision: row.revision_no, validationStatus: row.validation_status, totalRdiEnabled: row.total_rdi_enabled === 1, levelEnabled: row.level_enabled === 1, publishedAt: row.published_at })) }, requestId) }
async function getScoring(request: Request, env: Env, requestId: string, version: string): Promise<Response> { await readAdmin(request, env, requestId); const current = await scoringHeader(env.DB, version); if (!current) fail(404, 'SCORING_DEFINITION_NOT_FOUND', 'The scoring definition does not exist.'); return adminSuccessResponse({ version, displayName: current.display_name, status: current.status, revision: current.revision_no, validationStatus: current.validation_status, fingerprint: current.content_fingerprint, formulaFamily: current.formula_family, timeUnit: current.time_unit, totalRdiEnabled: current.total_rdi_enabled === 1, levelEnabled: current.level_enabled === 1, formula: JSON.parse(current.formula_config_json), weights: JSON.parse(current.weights_json) }, requestId) }

const normMetrics = ['RES', 'EACS', 'DDS', 'GDS', 'SLS'] as const
type NormMetric = typeof normMetrics[number]
type NormDocument = { displayName: string; scoringVersion: string; sourceType: 'manual_parameters' | 'external_analysis'; expectedRevision: number; sampleSize: number; populationNote: string; parameters: Record<NormMetric, { mean: number; sd: number }> }

function normDocument(body: Record<string, unknown>): NormDocument {
  rejectUnknown(body, ['displayName', 'scoringVersion', 'sourceType', 'expectedRevision', 'sampleSize', 'populationNote', 'parameters'])
  if (typeof body.displayName !== 'string' || !body.displayName.trim()) fail(400, 'NORM_DOCUMENT_INVALID', 'displayName is required.')
  const scoringVersion = requireVersion(body.scoringVersion, 'scoringVersion')
  if (body.sourceType !== 'manual_parameters' && body.sourceType !== 'external_analysis') fail(400, 'NORM_DOCUMENT_INVALID', 'sourceType is invalid.')
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) fail(400, 'NORM_DOCUMENT_INVALID', 'expectedRevision must be a positive integer.')
  if (!Number.isInteger(body.sampleSize) || (body.sampleSize as number) < 2) fail(400, 'NORM_DOCUMENT_INVALID', 'sampleSize must be an integer of at least 2.')
  if (typeof body.populationNote !== 'string' || !body.populationNote.trim()) fail(400, 'NORM_DOCUMENT_INVALID', 'populationNote is required.')
  if (!body.parameters || typeof body.parameters !== 'object' || Array.isArray(body.parameters) || Object.keys(body.parameters as object).length !== 5) fail(400, 'NORM_DOCUMENT_INVALID', 'Exactly five norm metric parameters are required.')
  const parameters = body.parameters as Record<string, unknown>
  const normalized = {} as Record<NormMetric, { mean: number; sd: number }>
  for (const metric of normMetrics) {
    const value = parameters[metric]
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value as object).some((key) => key !== 'mean' && key !== 'sd')) fail(400, 'NORM_DOCUMENT_INVALID', `Parameter ${metric} is invalid.`)
    const { mean, sd } = value as { mean: unknown; sd: unknown }
    if (typeof mean !== 'number' || !Number.isFinite(mean) || typeof sd !== 'number' || !Number.isFinite(sd) || sd <= 0) fail(400, 'NORM_DOCUMENT_INVALID', `Parameter ${metric} needs a finite mean and positive SD.`)
    normalized[metric] = { mean, sd }
  }
  if (Object.keys(parameters).some((metric) => !normMetrics.includes(metric as NormMetric))) fail(400, 'NORM_DOCUMENT_INVALID', 'Unknown norm metric.')
  return { displayName: body.displayName.trim(), scoringVersion, sourceType: body.sourceType, expectedRevision: body.expectedRevision as number, sampleSize: body.sampleSize as number, populationNote: body.populationNote.trim(), parameters: normalized }
}

async function normHeader(db: D1Database, version: string) {
  return db.prepare(`SELECT norm_version,display_name,scoring_version,source_type,status,sample_size,population_note,revision_no,validation_status,validation_report_json,content_fingerprint FROM norm_sets WHERE norm_version=?`).bind(version).first<{
    norm_version: string; display_name: string; scoring_version: string; source_type: 'manual_parameters' | 'external_analysis'; status: string; sample_size: number; population_note: string | null; revision_no: number; validation_status: string; validation_report_json: string; content_fingerprint: string | null
  }>()
}

async function loadNorm(db: D1Database, current: NonNullable<Awaited<ReturnType<typeof normHeader>>>): Promise<NormDocument> {
  const result = await db.prepare(`SELECT metric_code,mean_value,sd_value FROM norm_metric_parameters WHERE norm_version=? ORDER BY metric_code`).bind(current.norm_version).all<{ metric_code: NormMetric; mean_value: number; sd_value: number }>()
  const parameters = {} as Record<NormMetric, { mean: number; sd: number }>
  for (const row of result.results) parameters[row.metric_code] = { mean: Number(row.mean_value), sd: Number(row.sd_value) }
  return { displayName: current.display_name, scoringVersion: current.scoring_version, sourceType: current.source_type, expectedRevision: current.revision_no, sampleSize: current.sample_size, populationNote: current.population_note ?? '', parameters }
}

async function updateNorm(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  const current = await normHeader(env.DB, version)
  if (!current) fail(404, 'NORM_NOT_FOUND', 'The norm set does not exist.')
  if (current.status !== 'draft') fail(409, 'NORM_IMMUTABLE', 'Published norm sets cannot be changed.')
  const document = normDocument(context.body)
  const scoring = await env.DB.prepare(`SELECT status FROM scoring_definitions WHERE scoring_version=?`).bind(document.scoringVersion).first<{ status: string }>()
  if (!scoring || scoring.status !== 'published') fail(409, 'SCORING_VERSION_NOT_PUBLISHED', 'Norm drafts require a published scoring definition.')
  const fingerprint = await fingerprintNormContent(document)
  const now = new Date().toISOString(); const next = document.expectedRevision + 1
  const guard = `SELECT 1 FROM norm_sets WHERE norm_version=? AND status='draft' AND revision_no=? AND write_token=?`
  const data = { version, revision: next, validationStatus: 'stale', fingerprint }
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE norm_sets SET display_name=?,scoring_version=?,source_type=?,sample_size=?,population_note=?,revision_no=revision_no+1,validation_status='stale',validation_report_json=json('{"errors":[],"warnings":[]}'),content_fingerprint=?,validated_at=NULL,updated_by_admin_user_id=?,updated_at=?,write_token=? WHERE norm_version=? AND status='draft' AND revision_no=?`).bind(document.displayName, document.scoringVersion, document.sourceType, document.sampleSize, document.populationNote, fingerprint, context.admin.adminUserId, now, context.key, version, document.expectedRevision),
    env.DB.prepare(`DELETE FROM norm_metric_parameters WHERE norm_version=? AND EXISTS (${guard})`).bind(version, version, next, context.key),
  ]
  for (const metric of normMetrics) statements.push(env.DB.prepare(`INSERT INTO norm_metric_parameters (norm_version,metric_code,mean_value,sd_value,created_at) SELECT ?,?,?,?,? WHERE EXISTS (${guard})`).bind(version, metric, document.parameters[metric].mean, document.parameters[metric].sd, now, version, next, context.key))
  statements.push(
    env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (${guard})`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'norm_set_updated', 'success', 'norm_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: next, validationStatus: 'stale', sampleSize: document.sampleSize, metricCount: 5, fingerprint, warningCount: 0, errorCount: 0 }), now, version, next, context.key),
    env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (${guard})`).bind(context.key, context.admin.adminUserId, 'norm_set_updated', 'norm_set', version, context.requestHash, JSON.stringify(data), now, version, next, context.key),
  )
  const result = await env.DB.batch(statements)
  if (result[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The norm draft changed before this update could be applied.')
  return adminSuccessResponse(data, requestId)
}

async function validateNorm(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['expectedRevision']); const expected = context.body.expectedRevision
  if (!Number.isInteger(expected) || (expected as number) < 1) fail(400, 'NORM_DOCUMENT_INVALID', 'expectedRevision must be a positive integer.')
  const current = await normHeader(env.DB, version); if (!current) fail(404, 'NORM_NOT_FOUND', 'The norm set does not exist.')
  if (current.status !== 'draft') fail(409, 'NORM_IMMUTABLE', 'Published norm sets cannot be changed.')
  if (current.revision_no !== expected) fail(409, 'REVISION_CONFLICT', 'The norm draft changed before validation.')
  const document = await loadNorm(env.DB, current)
  let errors: { code: string; path: string; message: string }[] = []
  try { normDocument(document as unknown as Record<string, unknown>) } catch { errors = [{ code: 'NORM_DOCUMENT_INVALID', path: '', message: 'The complete norm document is invalid.' }] }
  const fingerprint = await fingerprintNormContent(document); const status = errors.length ? 'invalid' : 'valid'; const now = new Date().toISOString()
  const report = { errors, warnings: [] }; const data = { version, revision: expected, validationStatus: status, fingerprint, report }
  const guard = `SELECT 1 FROM norm_sets WHERE norm_version=? AND status='draft' AND revision_no=? AND write_token=?`
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE norm_sets SET validation_status=?,validation_report_json=json(?),content_fingerprint=?,validated_at=?,updated_at=?,write_token=? WHERE norm_version=? AND status='draft' AND revision_no=?`).bind(status, JSON.stringify(report), fingerprint, now, now, context.key, version, expected),
    env.DB.prepare(`INSERT INTO analysis_validation_runs (validation_run_id,object_type,object_version,revision_no,content_fingerprint,validation_status,errors_json,warnings_json,request_id,validated_by_admin_user_id,validated_at) SELECT ?,'norm',?,?,?,?,json(?),json(?),?,?,? WHERE EXISTS (${guard})`).bind(crypto.randomUUID(), version, expected, fingerprint, status, JSON.stringify(errors), '[]', requestId, context.admin.adminUserId, now, version, expected, context.key),
    env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (${guard})`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'norm_set_validated', 'success', 'norm_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: expected, validationStatus: status, sampleSize: document.sampleSize, metricCount: Object.keys(document.parameters).length, fingerprint, warningCount: 0, errorCount: errors.length }), now, version, expected, context.key),
    env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (${guard})`).bind(context.key, context.admin.adminUserId, 'norm_set_validated', 'norm_set', version, context.requestHash, JSON.stringify(data), now, version, expected, context.key),
  ])
  if (results[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The norm draft changed before validation could be recorded.')
  return adminSuccessResponse(data, requestId)
}

async function publishNorm(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['expectedRevision']); const expected = context.body.expectedRevision
  if (!Number.isInteger(expected) || (expected as number) < 1) fail(400, 'NORM_DOCUMENT_INVALID', 'expectedRevision must be a positive integer.')
  const current = await normHeader(env.DB, version); if (!current) fail(404, 'NORM_NOT_FOUND', 'The norm set does not exist.')
  if (current.status !== 'draft') fail(409, 'NORM_IMMUTABLE', 'Published norm sets cannot be changed.')
  const document = await loadNorm(env.DB, current); const fingerprint = await fingerprintNormContent(document)
  const last = await env.DB.prepare(`SELECT revision_no,content_fingerprint,validation_status FROM analysis_validation_runs WHERE object_type='norm' AND object_version=? ORDER BY validated_at DESC LIMIT 1`).bind(version).first<{ revision_no: number; content_fingerprint: string; validation_status: string }>()
  if (current.revision_no !== expected || current.validation_status !== 'valid' || current.content_fingerprint !== fingerprint || !last || last.revision_no !== expected || last.content_fingerprint !== fingerprint || last.validation_status !== 'valid') fail(409, 'VALIDATION_STALE', 'A matching valid validation is required before publication.')
  const now = new Date().toISOString(); const data = { version, status: 'published', revision: expected, fingerprint }
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE norm_sets SET status='published',published_at=?,published_by_admin_user_id=?,updated_at=?,write_token=? WHERE norm_version=? AND status='draft' AND revision_no=? AND validation_status='valid' AND content_fingerprint=?`).bind(now, context.admin.adminUserId, now, context.key, version, expected, fingerprint),
    env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM norm_sets WHERE norm_version=? AND status='published' AND write_token=?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'norm_set_published', 'success', 'norm_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: expected, validationStatus: 'valid', sampleSize: document.sampleSize, metricCount: 5, fingerprint, warningCount: 0, errorCount: 0 }), now, version, context.key),
    env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM norm_sets WHERE norm_version=? AND status='published' AND write_token=?)`).bind(context.key, context.admin.adminUserId, 'norm_set_published', 'norm_set', version, context.requestHash, JSON.stringify(data), now, version, context.key),
  ])
  if (result[0].meta.changes !== 1) fail(409, 'PUBLISH_CONFLICT', 'The norm could not be published because the draft changed.')
  return adminSuccessResponse(data, requestId)
}

async function createReliability(request: Request, env: Env, requestId: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['version', 'displayName', 'scoringVersion', 'cloneFrom'])
  const version = requireVersion(context.body.version, 'version'); const scoringVersion = requireVersion(context.body.scoringVersion, 'scoringVersion')
  if (typeof context.body.displayName !== 'string' || !context.body.displayName.trim()) fail(400, 'RELIABILITY_DOCUMENT_INVALID', 'displayName is required.')
  const scoring = await env.DB.prepare(`SELECT status FROM scoring_definitions WHERE scoring_version=?`).bind(scoringVersion).first<{ status: string }>()
  if (!scoring || scoring.status !== 'published') fail(409, 'SCORING_VERSION_NOT_PUBLISHED', 'Reliability drafts require a published scoring definition.')
  const cloneFrom = context.body.cloneFrom === undefined ? null : requireVersion(context.body.cloneFrom, 'cloneFrom')
  const source = cloneFrom
    ? await env.DB.prepare(`SELECT reliability_version FROM reliability_parameters WHERE reliability_version=? AND scoring_version=? AND status='published'`).bind(cloneFrom, scoringVersion).first<{ reliability_version: string }>()
    : null
  if (cloneFrom && !source) fail(409, 'RELIABILITY_CLONE_SOURCE_INVALID', 'The clone source must be a compatible published reliability set.')
  const now = new Date().toISOString(); const data = { version, displayName: context.body.displayName.trim(), scoringVersion, sourceVersion: cloneFrom, metricCode: 'EAC', status: 'draft', revision: 1, validationStatus: 'not_validated' }
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO reliability_parameters (reliability_version,scoring_version,metric_code,sd_value,reliability_value,status,sample_size,created_at,published_at,display_name,source_reliability_version,revision_no,validation_status,validation_report_json,content_fingerprint,population_note,created_by_admin_user_id,updated_by_admin_user_id,updated_at,validated_at,write_token) VALUES (?,?,'EAC',NULL,NULL,'draft',0,?,NULL,?,?,1,'not_validated',json('{"errors":[],"warnings":[]}'),NULL,NULL,?,?,?,NULL,?)`).bind(version, scoringVersion, now, data.displayName, cloneFrom, context.admin.adminUserId, context.admin.adminUserId, now, context.key),
      env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'reliability_set_created', 'success', 'reliability_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: 1, validationStatus: 'not_validated', metricCount: 1, warningCount: 0, errorCount: 0 }), now),
      env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) VALUES (?,?,?,?,?,?,201,json(?),?)`).bind(context.key, context.admin.adminUserId, 'reliability_set_created', 'reliability_set', version, context.requestHash, JSON.stringify(data), now),
    ])
  } catch { fail(409, 'RELIABILITY_CREATE_CONFLICT', 'The reliability version already exists or could not be created.') }
  return adminSuccessResponse(data, requestId, 201)
}

async function createScoringDefinition(request: Request, env: Env, requestId: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['version', 'displayName', 'cloneFrom'])
  const version = requireVersion(context.body.version, 'version'); const sourceVersion = requireVersion(context.body.cloneFrom, 'cloneFrom')
  if (typeof context.body.displayName !== 'string' || !context.body.displayName.trim()) fail(400, 'SCORING_DEFINITION_INVALID', 'displayName is required.')
  const source = await env.DB.prepare(`SELECT formula_family,total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit FROM scoring_definitions WHERE scoring_version=? AND status='published'`).bind(sourceVersion).first<{
    formula_family: string; total_rdi_enabled: number; level_enabled: number; formula_config_json: string; weights_json: string; time_unit: string
  }>()
  if (!source) fail(409, 'SCORING_CLONE_SOURCE_INVALID', 'The clone source must be a published scoring definition.')
  const now = new Date().toISOString(); const data = { version, displayName: context.body.displayName.trim(), sourceVersion, status: 'draft', revision: 1, validationStatus: 'not_validated' }
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO scoring_definitions (scoring_version,display_name,formula_family,status,is_pre_pilot,total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit,created_at,published_at,source_scoring_version,revision_no,validation_status,validation_report_json,content_fingerprint,created_by_admin_user_id,updated_by_admin_user_id,published_by_admin_user_id,updated_at,validated_at,write_token) VALUES (?,?,?,'draft',0,?,?,json(?),json(?),?,?,NULL,?,1,'not_validated',json('{"errors":[],"warnings":[]}'),NULL,?,?,NULL,?,NULL,?)`).bind(version, data.displayName, source.formula_family, source.total_rdi_enabled, source.level_enabled, source.formula_config_json, source.weights_json, source.time_unit, now, sourceVersion, context.admin.adminUserId, context.admin.adminUserId, now, context.key),
      env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,json(?),?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'scoring_definition_created', 'success', 'scoring_definition', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: 1, validationStatus: 'not_validated', totalRdiEnabled: source.total_rdi_enabled === 1, warningCount: 0, errorCount: 0 }), now),
      env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) VALUES (?,?,?,?,?,?,201,json(?),?)`).bind(context.key, context.admin.adminUserId, 'scoring_definition_created', 'scoring_definition', version, context.requestHash, JSON.stringify(data), now),
    ])
  } catch { fail(409, 'SCORING_CREATE_CONFLICT', 'The scoring definition version already exists or could not be created.') }
  return adminSuccessResponse(data, requestId, 201)
}

type ReliabilityDocument = { displayName: string; scoringVersion: string; expectedRevision: number; metricCode: 'EAC'; sd: number; reliability: number; sampleSize: number; populationNote: string }
function reliabilityDocument(body: Record<string, unknown>): ReliabilityDocument {
  rejectUnknown(body, ['displayName', 'scoringVersion', 'expectedRevision', 'metricCode', 'sd', 'reliability', 'sampleSize', 'populationNote'])
  if (typeof body.displayName !== 'string' || !body.displayName.trim() || !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || body.metricCode !== 'EAC' || typeof body.sd !== 'number' || !Number.isFinite(body.sd) || body.sd <= 0 || typeof body.reliability !== 'number' || !Number.isFinite(body.reliability) || body.reliability <= 0 || body.reliability > 1 || !Number.isInteger(body.sampleSize) || (body.sampleSize as number) < 2 || typeof body.populationNote !== 'string' || !body.populationNote.trim()) fail(400, 'RELIABILITY_DOCUMENT_INVALID', 'A complete EAC reliability document is required.')
  return { displayName: body.displayName.trim(), scoringVersion: requireVersion(body.scoringVersion, 'scoringVersion'), expectedRevision: body.expectedRevision as number, metricCode: 'EAC', sd: body.sd, reliability: body.reliability, sampleSize: body.sampleSize as number, populationNote: body.populationNote.trim() }
}
async function reliabilityHeader(db: D1Database, version: string) { return db.prepare(`SELECT reliability_version,display_name,scoring_version,metric_code,sd_value,reliability_value,status,sample_size,population_note,revision_no,validation_status,content_fingerprint FROM reliability_parameters WHERE reliability_version=?`).bind(version).first<{ reliability_version: string; display_name: string; scoring_version: string; metric_code: 'EAC'; sd_value: number; reliability_value: number; status: string; sample_size: number; population_note: string | null; revision_no: number; validation_status: string; content_fingerprint: string | null }>() }
async function updateReliability(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  const current = await reliabilityHeader(env.DB, version); if (!current) fail(404, 'RELIABILITY_NOT_FOUND', 'The reliability set does not exist.'); if (current.status !== 'draft') fail(409, 'RELIABILITY_IMMUTABLE', 'Published reliability sets cannot be changed.')
  const document = reliabilityDocument(context.body); const scoring = await env.DB.prepare(`SELECT status FROM scoring_definitions WHERE scoring_version=?`).bind(document.scoringVersion).first<{ status: string }>(); if (!scoring || scoring.status !== 'published') fail(409, 'SCORING_VERSION_NOT_PUBLISHED', 'Reliability drafts require a published scoring definition.')
  const fingerprint = await fingerprintReliabilityContent(document); const now = new Date().toISOString(); const next = document.expectedRevision + 1; const data = { version, revision: next, validationStatus: 'stale', fingerprint }
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE reliability_parameters SET display_name=?,scoring_version=?,metric_code='EAC',sd_value=?,reliability_value=?,sample_size=?,population_note=?,revision_no=revision_no+1,validation_status='stale',validation_report_json=json('{"errors":[],"warnings":[]}'),content_fingerprint=?,validated_at=NULL,updated_by_admin_user_id=?,updated_at=?,write_token=? WHERE reliability_version=? AND status='draft' AND revision_no=?`).bind(document.displayName, document.scoringVersion, document.sd, document.reliability, document.sampleSize, document.populationNote, fingerprint, context.admin.adminUserId, now, context.key, version, document.expectedRevision),
    env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND write_token=?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'reliability_set_updated', 'success', 'reliability_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: next, validationStatus: 'stale', sampleSize: document.sampleSize, metricCount: 1, fingerprint, warningCount: 0, errorCount: 0 }), now, version, context.key),
    env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND write_token=?)`).bind(context.key, context.admin.adminUserId, 'reliability_set_updated', 'reliability_set', version, context.requestHash, JSON.stringify(data), now, version, context.key),
  ]); if (result[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The reliability draft changed before this update could be applied.'); return adminSuccessResponse(data, requestId)
}
async function validateReliability(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status); rejectUnknown(context.body, ['expectedRevision']); const expected = context.body.expectedRevision
  const current = await reliabilityHeader(env.DB, version); if (!current) fail(404, 'RELIABILITY_NOT_FOUND', 'The reliability set does not exist.'); if (current.status !== 'draft') fail(409, 'RELIABILITY_IMMUTABLE', 'Published reliability sets cannot be changed.'); if (!Number.isInteger(expected) || current.revision_no !== expected) fail(409, 'REVISION_CONFLICT', 'The reliability draft changed before validation.')
  const document: ReliabilityDocument = { displayName: current.display_name, scoringVersion: current.scoring_version, expectedRevision: current.revision_no, metricCode: current.metric_code, sd: current.sd_value, reliability: current.reliability_value, sampleSize: current.sample_size, populationNote: current.population_note ?? '' }; let errors: unknown[] = []; try { reliabilityDocument(document as unknown as Record<string, unknown>) } catch { errors = [{ code: 'RELIABILITY_DOCUMENT_INVALID', path: '', message: 'The complete reliability document is invalid.' }] }
  const fingerprint = await fingerprintReliabilityContent(document); const status = errors.length ? 'invalid' : 'valid'; const now = new Date().toISOString(); const data = { version, revision: expected, validationStatus: status, fingerprint, report: { errors, warnings: [] } }
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE reliability_parameters SET validation_status=?,validation_report_json=json(?),content_fingerprint=?,validated_at=?,updated_at=?,write_token=? WHERE reliability_version=? AND status='draft' AND revision_no=?`).bind(status, JSON.stringify(data.report), fingerprint, now, now, context.key, version, expected),
    env.DB.prepare(`INSERT INTO analysis_validation_runs (validation_run_id,object_type,object_version,revision_no,content_fingerprint,validation_status,errors_json,warnings_json,request_id,validated_by_admin_user_id,validated_at) SELECT ?,'reliability',?,?,?,?,json(?),json(?),?,?,? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND write_token=?)`).bind(crypto.randomUUID(), version, expected, fingerprint, status, JSON.stringify(errors), '[]', requestId, context.admin.adminUserId, now, version, context.key),
    env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND write_token=?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'reliability_set_validated', 'success', 'reliability_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: current.revision_no, validationStatus: status, sampleSize: document.sampleSize, metricCount: 1, fingerprint, warningCount: 0, errorCount: errors.length }), now, version, context.key),
    env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND write_token=?)`).bind(context.key, context.admin.adminUserId, 'reliability_set_validated', 'reliability_set', version, context.requestHash, JSON.stringify(data), now, version, context.key),
  ]); if (result[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The reliability draft changed before validation could be recorded.'); return adminSuccessResponse(data, requestId)
}
async function publishReliability(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status); rejectUnknown(context.body, ['expectedRevision']); const expected = context.body.expectedRevision
  const current = await reliabilityHeader(env.DB, version); if (!current) fail(404, 'RELIABILITY_NOT_FOUND', 'The reliability set does not exist.'); if (current.status !== 'draft') fail(409, 'RELIABILITY_IMMUTABLE', 'Published reliability sets cannot be changed.'); const document: ReliabilityDocument = { displayName: current.display_name, scoringVersion: current.scoring_version, expectedRevision: current.revision_no, metricCode: current.metric_code, sd: current.sd_value, reliability: current.reliability_value, sampleSize: current.sample_size, populationNote: current.population_note ?? '' }; const fingerprint = await fingerprintReliabilityContent(document)
  const last = await env.DB.prepare(`SELECT revision_no,content_fingerprint,validation_status FROM analysis_validation_runs WHERE object_type='reliability' AND object_version=? ORDER BY validated_at DESC LIMIT 1`).bind(version).first<{ revision_no: number; content_fingerprint: string; validation_status: string }>(); if (!Number.isInteger(expected) || current.revision_no !== expected || current.validation_status !== 'valid' || current.content_fingerprint !== fingerprint || !last || last.revision_no !== expected || last.validation_status !== 'valid' || last.content_fingerprint !== fingerprint) fail(409, 'VALIDATION_STALE', 'A matching valid validation is required before publication.')
  const now = new Date().toISOString(); const data = { version, status: 'published', revision: expected, fingerprint }; const result = await env.DB.batch([env.DB.prepare(`UPDATE reliability_parameters SET status='published',published_at=?,published_by_admin_user_id=?,updated_at=?,write_token=? WHERE reliability_version=? AND status='draft' AND revision_no=? AND validation_status='valid' AND content_fingerprint=?`).bind(now, context.admin.adminUserId, now, context.key, version, expected, fingerprint), env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND status='published' AND write_token=?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'reliability_set_published', 'success', 'reliability_set', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: expected, validationStatus: 'valid', sampleSize: document.sampleSize, metricCount: 1, fingerprint, warningCount: 0, errorCount: 0 }), now, version, context.key),env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM reliability_parameters WHERE reliability_version=? AND status='published' AND write_token=?)`).bind(context.key, context.admin.adminUserId, 'reliability_set_published', 'reliability_set', version, context.requestHash, JSON.stringify(data), now, version, context.key)]); if (result[0].meta.changes !== 1) fail(409, 'PUBLISH_CONFLICT', 'The reliability set could not be published.'); return adminSuccessResponse(data, requestId)
}

type ScoringDocument = { displayName: string; expectedRevision: number; formulaFamily: 'RDI-2.0'; timeUnit: 'second'; totalRdiEnabled: boolean; levelEnabled: false; weights: Record<NormMetric, number>; eacAggregation: 'available_case_mean'; eacsAggregation: 'available_case_mean'; riskAnchorPolicy: 'earliest_key_risk'; missingMetricPolicy: 'strict_complete_case'; slsMapping: { stopLoss: 100; giveUp: 80; continue: 30; notTriggered: null; timeoutUnanswered: null } }
function scoringDocument(body: Record<string, unknown>): ScoringDocument {
  rejectUnknown(body, ['displayName', 'expectedRevision', 'formulaFamily', 'timeUnit', 'totalRdiEnabled', 'levelEnabled', 'weights', 'eacAggregation', 'eacsAggregation', 'riskAnchorPolicy', 'missingMetricPolicy', 'slsMapping'])
  const weights = body.weights as Record<string, unknown>; const mapping = body.slsMapping as Record<string, unknown>
  if (typeof body.displayName !== 'string' || !body.displayName.trim() || !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || body.formulaFamily !== 'RDI-2.0' || body.timeUnit !== 'second' || typeof body.totalRdiEnabled !== 'boolean' || body.levelEnabled !== false || body.eacAggregation !== 'available_case_mean' || body.eacsAggregation !== 'available_case_mean' || body.riskAnchorPolicy !== 'earliest_key_risk' || body.missingMetricPolicy !== 'strict_complete_case' || !weights || typeof weights !== 'object' || Object.keys(weights).length !== 5 || normMetrics.some((metric) => typeof weights[metric] !== 'number' || !Number.isFinite(weights[metric]) || weights[metric] < 0) || Math.abs(normMetrics.reduce((sum, metric) => sum + Number(weights[metric]), 0) - 1) > 1e-9 || !mapping || Object.keys(mapping).length !== 5 || mapping.stopLoss !== 100 || mapping.giveUp !== 80 || mapping.continue !== 30 || mapping.notTriggered !== null || mapping.timeoutUnanswered !== null) fail(400, 'SCORING_DEFINITION_INVALID', 'A complete structured RDI-2.0 scoring definition is required.')
  return { displayName: body.displayName.trim(), expectedRevision: body.expectedRevision as number, formulaFamily: 'RDI-2.0', timeUnit: 'second', totalRdiEnabled: body.totalRdiEnabled, levelEnabled: false, weights: weights as Record<NormMetric, number>, eacAggregation: 'available_case_mean', eacsAggregation: 'available_case_mean', riskAnchorPolicy: 'earliest_key_risk', missingMetricPolicy: 'strict_complete_case', slsMapping: mapping as ScoringDocument['slsMapping'] }
}
async function scoringHeader(db: D1Database, version: string) { return db.prepare(`SELECT scoring_version,display_name,status,revision_no,validation_status,content_fingerprint,formula_family,total_rdi_enabled,level_enabled,formula_config_json,weights_json,time_unit FROM scoring_definitions WHERE scoring_version=?`).bind(version).first<{ scoring_version:string; display_name:string; status:string; revision_no:number; validation_status:string; content_fingerprint:string|null; formula_family:string; total_rdi_enabled:number; level_enabled:number; formula_config_json:string; weights_json:string; time_unit:string }>() }
async function updateScoring(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status); const current = await scoringHeader(env.DB, version); if (!current) fail(404, 'SCORING_DEFINITION_NOT_FOUND', 'The scoring definition does not exist.'); if (current.status !== 'draft') fail(409, 'SCORING_DEFINITION_IMMUTABLE', 'Published scoring definitions cannot be changed.'); const document = scoringDocument(context.body); const fingerprint = await fingerprintScoringDefinitionContent(document); const now = new Date().toISOString(); const next = document.expectedRevision + 1; const formula = { eacAggregation: document.eacAggregation, eacsAggregation: document.eacsAggregation, riskAnchorPolicy: document.riskAnchorPolicy, missingMetricPolicy: document.missingMetricPolicy, slsMapping: document.slsMapping }; const data = { version, revision: next, validationStatus: 'stale', fingerprint }
  const result = await env.DB.batch([env.DB.prepare(`UPDATE scoring_definitions SET display_name=?,formula_family='RDI-2.0',total_rdi_enabled=?,level_enabled=0,formula_config_json=json(?),weights_json=json(?),time_unit='second',revision_no=revision_no+1,validation_status='stale',validation_report_json=json('{"errors":[],"warnings":[]}'),content_fingerprint=?,validated_at=NULL,updated_by_admin_user_id=?,updated_at=?,write_token=? WHERE scoring_version=? AND status='draft' AND revision_no=?`).bind(document.displayName, document.totalRdiEnabled ? 1 : 0, JSON.stringify(formula), JSON.stringify(document.weights), fingerprint, context.admin.adminUserId, now, context.key, version, document.expectedRevision), env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND write_token=?)`).bind(crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, 'scoring_definition_updated', 'success', 'scoring_definition', version, requestId, context.admin.clientFingerprintHash, JSON.stringify({ version, revision: next, validationStatus: 'stale', totalRdiEnabled: document.totalRdiEnabled, fingerprint, warningCount: 0, errorCount: 0 }), now, version, context.key), env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND write_token=?)`).bind(context.key, context.admin.adminUserId, 'scoring_definition_updated', 'scoring_definition', version, context.requestHash, JSON.stringify(data), now, version, context.key)]); if (result[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The scoring definition changed before update.'); return adminSuccessResponse(data, requestId)
}
async function validateScoring(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await writeContext(request, env, requestId); if (context.replay) return adminSuccessResponse(context.replay.data, requestId); rejectUnknown(context.body, ['expectedRevision']); const current = await scoringHeader(env.DB, version); if (!current) fail(404, 'SCORING_DEFINITION_NOT_FOUND', 'The scoring definition does not exist.'); if (current.status !== 'draft') fail(409, 'SCORING_DEFINITION_IMMUTABLE', 'Published scoring definitions cannot be changed.'); if (!Number.isInteger(context.body.expectedRevision) || current.revision_no !== context.body.expectedRevision) fail(409, 'REVISION_CONFLICT', 'The scoring definition changed before validation.'); const formula = JSON.parse(current.formula_config_json) as Record<string, unknown>; const document = { displayName: current.display_name, expectedRevision: current.revision_no, formulaFamily: current.formula_family, timeUnit: current.time_unit, totalRdiEnabled: current.total_rdi_enabled === 1, levelEnabled: current.level_enabled === 1, weights: JSON.parse(current.weights_json), ...formula } as unknown as Record<string, unknown>; let errors: unknown[]=[]; try { scoringDocument(document) } catch { errors=[{code:'SCORING_DEFINITION_INVALID',path:'',message:'The complete scoring definition is invalid.'}] }; const fingerprint=await fingerprintScoringDefinitionContent(document); const status=errors.length?'invalid':'valid'; const now=new Date().toISOString(); const data={version,revision:current.revision_no,validationStatus:status,fingerprint,report:{errors,warnings:[]}}; const result=await env.DB.batch([env.DB.prepare(`UPDATE scoring_definitions SET validation_status=?,validation_report_json=json(?),content_fingerprint=?,validated_at=?,updated_at=?,write_token=? WHERE scoring_version=? AND status='draft' AND revision_no=?`).bind(status,JSON.stringify(data.report),fingerprint,now,now,context.key,version,current.revision_no),env.DB.prepare(`INSERT INTO analysis_validation_runs (validation_run_id,object_type,object_version,revision_no,content_fingerprint,validation_status,errors_json,warnings_json,request_id,validated_by_admin_user_id,validated_at) SELECT ?,'scoring_definition',?,?,?,?,json(?),json(?),?,?,? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND write_token=?)`).bind(crypto.randomUUID(),version,current.revision_no,fingerprint,status,JSON.stringify(errors),'[]',requestId,context.admin.adminUserId,now,version,context.key),env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND write_token=?)`).bind(crypto.randomUUID(),context.admin.adminUserId,context.admin.adminSessionId,'scoring_definition_validated','success','scoring_definition',version,requestId,context.admin.clientFingerprintHash,JSON.stringify({version,revision:current.revision_no,validationStatus:status,fingerprint,warningCount:0,errorCount:errors.length}),now,version,context.key),env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND write_token=?)`).bind(context.key,context.admin.adminUserId,'scoring_definition_validated','scoring_definition',version,context.requestHash,JSON.stringify(data),now,version,context.key)]);if(result[0].meta.changes!==1)fail(409,'REVISION_CONFLICT','The scoring definition changed before validation.');return adminSuccessResponse(data,requestId)
}
async function publishScoring(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context=await writeContext(request,env,requestId);if(context.replay)return adminSuccessResponse(context.replay.data,requestId);rejectUnknown(context.body,['expectedRevision']);const current=await scoringHeader(env.DB,version);if(!current)fail(404,'SCORING_DEFINITION_NOT_FOUND','The scoring definition does not exist.');if(current.status!=='draft')fail(409,'SCORING_DEFINITION_IMMUTABLE','Published scoring definitions cannot be changed.');const formula=JSON.parse(current.formula_config_json);const document={displayName:current.display_name,expectedRevision:current.revision_no,formulaFamily:current.formula_family,timeUnit:current.time_unit,totalRdiEnabled:current.total_rdi_enabled===1,levelEnabled:current.level_enabled===1,weights:JSON.parse(current.weights_json),...formula};const fingerprint=await fingerprintScoringDefinitionContent(document);const last=await env.DB.prepare(`SELECT revision_no,content_fingerprint,validation_status FROM analysis_validation_runs WHERE object_type='scoring_definition' AND object_version=? ORDER BY validated_at DESC LIMIT 1`).bind(version).first<{revision_no:number;content_fingerprint:string;validation_status:string}>();if(!Number.isInteger(context.body.expectedRevision)||current.revision_no!==context.body.expectedRevision||current.validation_status!=='valid'||current.content_fingerprint!==fingerprint||!last||last.revision_no!==current.revision_no||last.content_fingerprint!==fingerprint||last.validation_status!=='valid')fail(409,'VALIDATION_STALE','A matching valid validation is required before publication.');const now=new Date().toISOString();const data={version,status:'published',revision:current.revision_no,fingerprint};const result=await env.DB.batch([env.DB.prepare(`UPDATE scoring_definitions SET status='published',published_at=?,published_by_admin_user_id=?,updated_at=?,write_token=? WHERE scoring_version=? AND status='draft' AND revision_no=? AND validation_status='valid' AND content_fingerprint=?`).bind(now,context.admin.adminUserId,now,context.key,version,current.revision_no,fingerprint),env.DB.prepare(`INSERT INTO admin_audit_logs (audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,json(?),? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND status='published' AND write_token=?)`).bind(crypto.randomUUID(),context.admin.adminUserId,context.admin.adminSessionId,'scoring_definition_published','success','scoring_definition',version,requestId,context.admin.clientFingerprintHash,JSON.stringify({version,revision:current.revision_no,validationStatus:'valid',totalRdiEnabled:current.total_rdi_enabled===1,fingerprint,warningCount:0,errorCount:0}),now,version,context.key),env.DB.prepare(`INSERT INTO admin_operation_receipts (idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at) SELECT ?,?,?,?,?,?,200,json(?),? WHERE EXISTS (SELECT 1 FROM scoring_definitions WHERE scoring_version=? AND status='published' AND write_token=?)`).bind(context.key,context.admin.adminUserId,'scoring_definition_published','scoring_definition',version,context.requestHash,JSON.stringify(data),now,version,context.key)]);if(result[0].meta.changes!==1)fail(409,'PUBLISH_CONFLICT','The scoring definition could not be published.');return adminSuccessResponse(data,requestId)
}

export async function handleAdminAnalysisParameters(request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const path = new URL(request.url).pathname
    if (path === '/api/admin/analysis/norm-sets' && request.method === 'GET') return await listNorms(request, env, requestId)
    if (path === '/api/admin/analysis/norm-sets' && request.method === 'POST') return await createNorm(request, env, requestId)
    if (path === '/api/admin/analysis/reliability-sets' && request.method === 'GET') return await listReliability(request, env, requestId)
    if (path === '/api/admin/analysis/reliability-sets' && request.method === 'POST') return await createReliability(request, env, requestId)
    if (path === '/api/admin/analysis/scoring-definitions' && request.method === 'GET') return await listScoring(request, env, requestId)
    if (path === '/api/admin/analysis/scoring-definitions' && request.method === 'POST') return await createScoringDefinition(request, env, requestId)
    const reliability = path.match(/^\/api\/admin\/analysis\/reliability-sets\/([^/]+)(?:\/(validate|publish))?$/)
    if (reliability) { const version = requireVersion(decodeURIComponent(reliability[1]), 'version'); if (!reliability[2] && request.method === 'GET') return await getReliability(request, env, requestId, version); if (!reliability[2] && request.method === 'PUT') return await updateReliability(request, env, requestId, version); if (reliability[2] === 'validate' && request.method === 'POST') return await validateReliability(request, env, requestId, version); if (reliability[2] === 'publish' && request.method === 'POST') return await publishReliability(request, env, requestId, version) }
    const scoring = path.match(/^\/api\/admin\/analysis\/scoring-definitions\/([^/]+)(?:\/(validate|publish))?$/)
    if (scoring) { const version = requireVersion(decodeURIComponent(scoring[1]), 'version'); if (!scoring[2] && request.method === 'GET') return await getScoring(request, env, requestId, version); if (!scoring[2] && request.method === 'PUT') return await updateScoring(request, env, requestId, version); if (scoring[2] === 'validate' && request.method === 'POST') return await validateScoring(request, env, requestId, version); if (scoring[2] === 'publish' && request.method === 'POST') return await publishScoring(request, env, requestId, version) }
    const norm = path.match(/^\/api\/admin\/analysis\/norm-sets\/([^/]+)(?:\/(validate|publish))?$/)
    if (norm) {
      const version = requireVersion(decodeURIComponent(norm[1]), 'version')
      if (!norm[2] && request.method === 'GET') return await getNorm(request, env, requestId, version)
      if (!norm[2] && request.method === 'PUT') return await updateNorm(request, env, requestId, version)
      if (norm[2] === 'validate' && request.method === 'POST') return await validateNorm(request, env, requestId, version)
      if (norm[2] === 'publish' && request.method === 'POST') return await publishNorm(request, env, requestId, version)
    }
    fail(404, 'NOT_FOUND', 'The requested analysis parameter endpoint does not exist.')
  } catch (error) {
    if (error instanceof ParameterError || error instanceof AdminAuthError || error instanceof AdminCsrfError) return adminErrorResponse(error.status, { code: error.code, message: error.message }, requestId)
    return adminErrorResponse(500, { code: 'ADMIN_ANALYSIS_FAILED', message: 'The analysis parameter request could not be completed.' }, requestId)
  }
}
