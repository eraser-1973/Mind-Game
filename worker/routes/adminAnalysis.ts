import { AdminAuthError, authenticateAdmin, type AdminContext } from '../auth/adminAuth'
import {
  analysisCandidateIds,
  validateExpertBenchmarkDocument,
  type AnalysisCandidateId,
  type ExpertBenchmarkDocument,
} from '../domain/analysisConfiguration'
import { fingerprintExpertBenchmarkContent } from '../domain/analysisFingerprint'
import { fingerprintRequest } from '../domain/configurationFingerprint'
import { sampleMeanAndSd } from '../domain/formalAnalysisMath'
import type { Env } from '../env'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import { AdminCsrfError, requireAdminCsrf } from '../security/adminCsrf'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VERSION = /^[A-Za-z0-9._-]{3,64}$/
const MAX_BODY_BYTES = 262_144

class AnalysisError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

type Header = {
  benchmark_version: string
  display_name: string
  source_benchmark_version: string | null
  source_type: 'expert_panel' | 'current_app_baseline'
  status: 'draft' | 'published' | 'retired'
  revision_no: number
  validation_status: string
  validation_report_json: string
  content_fingerprint: string | null
  expert_count: number
  rated_at: string | null
  validated_at: string | null
  published_at: string | null
}

type WriteContext = {
  admin: AdminContext
  requestId: string
  body: Record<string, unknown>
  key: string
  requestHash: string
  replay: { status: number; data: unknown } | null
}

function fail(status: number, code: string, message: string): never {
  throw new AnalysisError(status, code, message)
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'BENCHMARK_REQUEST_INVALID', 'The request must be a JSON object.')
  return body as Record<string, unknown>
}

function rejectUnknown(body: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(body).some((field) => !fields.includes(field))) fail(400, 'BENCHMARK_REQUEST_INVALID', 'The request contains unknown fields.')
}

function requireVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || !VERSION.test(value)) fail(400, 'BENCHMARK_REQUEST_INVALID', `${field} must be a 3-64 character version identifier.`)
  return value
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail(400, 'BENCHMARK_REQUEST_INVALID', 'expectedRevision must be a positive integer.')
  return value as number
}

async function readWriteContext(request: Request, env: Env, requestId: string): Promise<WriteContext> {
  const admin = await authenticateAdmin(request, env, { requestId })
  await requireAdminCsrf(request, admin)
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Analysis writes require application/json.')
  }
  const key = request.headers.get('Idempotency-Key') ?? ''
  if (!UUID.test(key)) fail(400, 'IDEMPOTENCY_KEY_INVALID', 'A UUID Idempotency-Key is required.')
  const source = await request.text()
  if (new TextEncoder().encode(source).byteLength > MAX_BODY_BYTES) fail(413, 'BENCHMARK_REQUEST_TOO_LARGE', 'The request is too large.')
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { fail(400, 'BENCHMARK_REQUEST_INVALID', 'The request must contain valid JSON.') }
  const body = requireObject(parsed)
  const requestHash = await fingerprintRequest({ method: request.method, path: new URL(request.url).pathname, body })
  const receipt = await env.DB.prepare(`SELECT admin_user_id,request_hash,response_status,response_json
    FROM admin_operation_receipts WHERE idempotency_key=?`).bind(key).first<{
      admin_user_id: string; request_hash: string; response_status: number; response_json: string
    }>()
  if (receipt) {
    if (receipt.admin_user_id !== admin.adminUserId || receipt.request_hash !== requestHash) {
      fail(409, 'IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was already used for a different request.')
    }
    return { admin, requestId, body, key, requestHash, replay: { status: receipt.response_status, data: JSON.parse(receipt.response_json) } }
  }
  return { admin, requestId, body, key, requestHash, replay: null }
}

function receiptStatement(db: D1Database, context: WriteContext, action: string, targetId: string, data: unknown, now: string, where = '', guardBindings: unknown[] = [], status = 200): D1PreparedStatement {
  return db.prepare(`INSERT INTO admin_operation_receipts (
    idempotency_key,admin_user_id,action,target_type,target_id,request_hash,response_status,response_json,created_at
  ) SELECT ?,?,?, 'benchmark_set', ?,?,?,json(?),? ${where}`).bind(
    context.key, context.admin.adminUserId, action, targetId, context.requestHash, status, JSON.stringify(data), now,
    ...guardBindings,
  )
}

function auditStatement(db: D1Database, context: WriteContext, action: 'benchmark_set_created' | 'benchmark_set_updated' | 'benchmark_set_validated' | 'benchmark_set_published', version: string, now: string, metadata: Record<string, unknown>, where = '', guardBindings: unknown[] = []): D1PreparedStatement {
  // Admin audit helpers deliberately bind all fields. A guarded SELECT keeps a
  // losing optimistic-concurrency batch from leaving an audit/receipt behind.
  return db.prepare(`INSERT INTO admin_audit_logs (
    audit_id,admin_user_id,admin_session_id,action,outcome,target_type,target_id,request_id,client_fingerprint_hash,metadata_json,created_at
  ) SELECT ?,?,?,?,?,?,?,?,?,json(?),? ${where}`).bind(
    crypto.randomUUID(), context.admin.adminUserId, context.admin.adminSessionId, action, 'success',
    'benchmark_set', version, context.requestId, context.admin.clientFingerprintHash,
    JSON.stringify(metadata), now, ...guardBindings,
  )
}

async function header(db: D1Database, version: string): Promise<Header | null> {
  return db.prepare(`SELECT benchmark_version,display_name,source_benchmark_version,source_type,status,
    revision_no,validation_status,validation_report_json,content_fingerprint,expert_count,rated_at,
    validated_at,published_at FROM benchmark_sets WHERE benchmark_version=?`).bind(version).first<Header>()
}

async function loadDocument(db: D1Database, current: Header): Promise<ExpertBenchmarkDocument> {
  const [policies, scores] = await Promise.all([
    db.prepare(`SELECT candidate_id,direction,include_in_core_eac FROM benchmark_candidate_policies
      WHERE benchmark_version=? ORDER BY candidate_id`).bind(current.benchmark_version).all<{
        candidate_id: AnalysisCandidateId; direction: -1 | 0 | 1; include_in_core_eac: number
      }>(),
    db.prepare(`SELECT expert_code,candidate_id,score FROM benchmark_expert_scores
      WHERE benchmark_version=? ORDER BY expert_code,candidate_id`).bind(current.benchmark_version).all<{
        expert_code: string; candidate_id: AnalysisCandidateId; score: number
      }>(),
  ])
  const experts = new Map<string, Partial<Record<AnalysisCandidateId, number>>>()
  for (const score of scores.results) {
    const values = experts.get(score.expert_code) ?? {}
    values[score.candidate_id] = Number(score.score)
    experts.set(score.expert_code, values)
  }
  return {
    displayName: current.display_name,
    expectedRevision: current.revision_no,
    ratedAt: current.rated_at ?? '',
    candidatePolicies: policies.results.map((policy) => ({
      candidateId: policy.candidate_id, direction: policy.direction,
      includeInCoreEac: policy.include_in_core_eac === 1,
    })),
    experts: [...experts.entries()].map(([expertCode, scores]) => ({
      expertCode, scores: scores as Record<AnalysisCandidateId, number>,
    })),
  }
}

function documentFromUpdate(body: Record<string, unknown>): ExpertBenchmarkDocument {
  rejectUnknown(body, ['displayName', 'ratedAt', 'expectedRevision', 'candidatePolicies', 'experts'])
  return body as unknown as ExpertBenchmarkDocument
}

function validationProjection(document: ExpertBenchmarkDocument) {
  const validation = validateExpertBenchmarkDocument(document)
  const candidates = Object.fromEntries(analysisCandidateIds.map((candidateId) => {
    const scores = document.experts.map((expert) => expert.scores[candidateId])
    if (scores.length < 2 || scores.some((score) => !Number.isFinite(score))) return [candidateId, null]
    const stats = sampleMeanAndSd(scores)
    return [candidateId, stats ? { mean: stats.mean, sampleSd: stats.sampleSd } : null]
  }))
  return { validation, preview: { expertCount: document.experts.length, candidates } }
}

function projection(current: Header, document: ExpertBenchmarkDocument, includeMatrix = true) {
  return {
    version: current.benchmark_version, displayName: current.display_name, sourceVersion: current.source_benchmark_version,
    sourceType: current.source_type, status: current.status, revision: current.revision_no,
    validationStatus: current.validation_status, validationReport: JSON.parse(current.validation_report_json),
    fingerprint: current.content_fingerprint, expertCount: current.expert_count, ratedAt: current.rated_at,
    validatedAt: current.validated_at, publishedAt: current.published_at,
    ...(includeMatrix ? { candidatePolicies: document.candidatePolicies, experts: document.experts } : {}),
  }
}

function expectedPredicate(revision: number, key: string) {
  return `SELECT 1 FROM benchmark_sets WHERE benchmark_version=? AND status='draft' AND revision_no=${revision} AND write_token='${key}'`
}

async function list(request: Request, env: Env, requestId: string): Promise<Response> {
  await authenticateAdmin(request, env, { requestId })
  const result = await env.DB.prepare(`SELECT benchmark_version,display_name,status,revision_no,
    validation_status,is_provisional,expert_count,source_benchmark_version,published_at
    FROM benchmark_sets ORDER BY created_at DESC,benchmark_version`).all<Record<string, unknown>>()
  return adminSuccessResponse({ items: result.results.map((row) => ({
    version: row.benchmark_version, displayName: row.display_name, status: row.status, revision: row.revision_no,
    validationStatus: row.validation_status, isProvisional: row.is_provisional === 1,
    expertCount: row.expert_count, sourceVersion: row.source_benchmark_version, publishedAt: row.published_at,
  })) }, requestId)
}

async function create(request: Request, env: Env, requestId: string): Promise<Response> {
  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['version', 'displayName', 'clonePoliciesFrom'])
  const version = requireVersion(context.body.version, 'version')
  const sourceVersion = requireVersion(context.body.clonePoliciesFrom, 'clonePoliciesFrom')
  if (typeof context.body.displayName !== 'string' || !context.body.displayName.trim()) fail(400, 'BENCHMARK_REQUEST_INVALID', 'displayName is required.')
  const source = await header(env.DB, sourceVersion)
  const policies = await env.DB.prepare(`SELECT candidate_id,direction,include_in_core_eac
    FROM benchmark_candidate_policies WHERE benchmark_version=? ORDER BY candidate_id`).bind(sourceVersion)
    .all<{ candidate_id: AnalysisCandidateId; direction: number; include_in_core_eac: number }>()
  if (!source || source.status !== 'published' || policies.results.length !== 5) fail(409, 'BENCHMARK_CLONE_SOURCE_INVALID', 'The clone source must be a published A-E benchmark.')
  const now = new Date().toISOString()
  const data = { version, displayName: context.body.displayName.trim(), sourceVersion, sourceType: 'expert_panel', status: 'draft', revision: 1, validationStatus: 'not_validated', expertCount: 0 }
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO benchmark_sets (benchmark_version,display_name,source_benchmark_version,source_type,status,is_provisional,expert_count,revision_no,validation_status,validation_report_json,created_by_admin_user_id,updated_by_admin_user_id,created_at,updated_at)
        VALUES (?,?,?,'expert_panel','draft',0,0,1,'not_validated',json('{"errors":[],"warnings":[]}'),?,?,?,?)`)
        .bind(version, data.displayName, sourceVersion, context.admin.adminUserId, context.admin.adminUserId, now, now),
      ...policies.results.map((policy) => env.DB.prepare(`INSERT INTO benchmark_candidate_policies
        (benchmark_version,candidate_id,direction,include_in_core_eac,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
        .bind(version, policy.candidate_id, policy.direction, policy.include_in_core_eac, now, now)),
      auditStatement(env.DB, context, 'benchmark_set_created', version, now, { version, revision: 1, warningCount: 0, errorCount: 0 }),
      receiptStatement(env.DB, context, 'benchmark_set_created', version, data, now, '', [], 201),
    ])
  } catch {
    const receipt = await env.DB.prepare(`SELECT request_hash,response_status,response_json FROM admin_operation_receipts WHERE idempotency_key=?`).bind(context.key).first<{request_hash:string;response_status:number;response_json:string}>()
    if (receipt?.request_hash === context.requestHash) return adminSuccessResponse(JSON.parse(receipt.response_json), requestId, receipt.response_status)
    fail(409, 'BENCHMARK_CREATE_CONFLICT', 'The benchmark version already exists or could not be created.')
  }
  return adminSuccessResponse(data, requestId, 201)
}

async function getOne(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  await authenticateAdmin(request, env, { requestId })
  const current = await header(env.DB, version)
  if (!current) fail(404, 'BENCHMARK_NOT_FOUND', 'The benchmark set does not exist.')
  return adminSuccessResponse(projection(current, await loadDocument(env.DB, current)), requestId)
}

async function update(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  const document = documentFromUpdate(context.body)
  const expectedRevision = requirePositiveInteger(document.expectedRevision)
  const validation = validateExpertBenchmarkDocument(document)
  // A draft may contain one complete expert while the validation endpoint
  // correctly reports that the publishable panel minimum is two. Structural
  // matrix errors are never accepted; panel size is a validation outcome.
  if (validation.errors.some((issue) => issue.code !== 'EXPERT_PANEL_TOO_SMALL')) {
    fail(400, 'BENCHMARK_DOCUMENT_INVALID', 'The complete expert benchmark matrix is invalid.')
  }
  const now = new Date().toISOString()
  const contentFingerprint = await fingerprintExpertBenchmarkContent(document)
  const data = { version, revision: expectedRevision + 1, validationStatus: 'stale', fingerprint: contentFingerprint, warningCount: validation.warnings.length }
  const guard = expectedPredicate(expectedRevision + 1, context.key)
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE benchmark_sets SET display_name=?,rated_at=?,revision_no=revision_no+1,
      validation_status='stale',validation_report_json=json('{"errors":[],"warnings":[]}'),content_fingerprint=?,
      validated_at=NULL,updated_by_admin_user_id=?,updated_at=?,write_token=?
      WHERE benchmark_version=? AND status='draft' AND revision_no=?`).bind(
      document.displayName.trim(), document.ratedAt, contentFingerprint, context.admin.adminUserId, now, context.key, version, expectedRevision),
    env.DB.prepare(`DELETE FROM benchmark_expert_scores WHERE benchmark_version=? AND EXISTS (${guard})`).bind(version, version),
    env.DB.prepare(`DELETE FROM benchmark_candidate_policies WHERE benchmark_version=? AND EXISTS (${guard})`).bind(version, version),
  ]
  for (const policy of [...document.candidatePolicies].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    statements.push(env.DB.prepare(`INSERT INTO benchmark_candidate_policies
      (benchmark_version,candidate_id,direction,include_in_core_eac,created_at,updated_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (${guard})`).bind(version, policy.candidateId, policy.direction, policy.includeInCoreEac ? 1 : 0, now, now, version))
  }
  for (const expert of [...document.experts].sort((a, b) => a.expertCode.localeCompare(b.expertCode))) {
    for (const candidateId of analysisCandidateIds) {
      statements.push(env.DB.prepare(`INSERT INTO benchmark_expert_scores
        (expert_score_id,benchmark_version,candidate_id,expert_code,score,submitted_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (${guard})`).bind(crypto.randomUUID(), version, candidateId, expert.expertCode, expert.scores[candidateId], document.ratedAt, version))
    }
  }
  statements.push(
    auditStatement(env.DB, context, 'benchmark_set_updated', version, now, { version, revision: expectedRevision + 1, contentFingerprint, warningCount: validation.warnings.length, errorCount: 0 }, `WHERE EXISTS (${guard})`, [version]),
    receiptStatement(env.DB, context, 'benchmark_set_updated', version, data, now, `WHERE EXISTS (${guard})`, [version]),
  )
  const results = await env.DB.batch(statements)
  if (results[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The benchmark draft changed before this update could be applied.')
  return adminSuccessResponse(data, requestId)
}

async function validate(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['expectedRevision'])
  const expectedRevision = requirePositiveInteger(context.body.expectedRevision)
  const current = await header(env.DB, version)
  if (!current) fail(404, 'BENCHMARK_NOT_FOUND', 'The benchmark set does not exist.')
  if (current.status !== 'draft') fail(409, 'BENCHMARK_IMMUTABLE', 'Published benchmark sets cannot be changed.')
  if (current.revision_no !== expectedRevision) fail(409, 'REVISION_CONFLICT', 'The benchmark draft changed before validation.')
  const document = await loadDocument(env.DB, current)
  const { validation: result, preview } = validationProjection(document)
  const fingerprint = await fingerprintExpertBenchmarkContent(document)
  const now = new Date().toISOString()
  const report = { errors: result.errors, warnings: result.warnings, preview }
  const data = { version, revision: expectedRevision, validationStatus: result.errors.length ? 'invalid' : 'valid', fingerprint, report }
  const guard = expectedPredicate(expectedRevision, context.key)
  const statements = [
    env.DB.prepare(`UPDATE benchmark_sets SET validation_status=?,validation_report_json=json(?),content_fingerprint=?,validated_at=?,updated_at=?,write_token=?
      WHERE benchmark_version=? AND status='draft' AND revision_no=?`).bind(data.validationStatus, JSON.stringify(report), fingerprint, now, now, context.key, version, expectedRevision),
    env.DB.prepare(`INSERT INTO analysis_validation_runs (validation_run_id,object_type,object_version,revision_no,content_fingerprint,validation_status,errors_json,warnings_json,request_id,validated_by_admin_user_id,validated_at)
      SELECT ?, 'benchmark', ?, ?, ?, ?, json(?), json(?), ?, ?, ? WHERE EXISTS (${guard})`).bind(crypto.randomUUID(), version, expectedRevision, fingerprint, data.validationStatus, JSON.stringify(result.errors), JSON.stringify(result.warnings), requestId, context.admin.adminUserId, now, version),
    auditStatement(env.DB, context, 'benchmark_set_validated', version, now, { version, revision: expectedRevision, contentFingerprint: fingerprint, warningCount: result.warnings.length, errorCount: result.errors.length }, `WHERE EXISTS (${guard})`, [version]),
    receiptStatement(env.DB, context, 'benchmark_set_validated', version, data, now, `WHERE EXISTS (${guard})`, [version]),
  ]
  const results = await env.DB.batch(statements)
  if (results[0].meta.changes !== 1) fail(409, 'REVISION_CONFLICT', 'The benchmark draft changed before validation could be recorded.')
  return adminSuccessResponse(data, requestId)
}

async function publish(request: Request, env: Env, requestId: string, version: string): Promise<Response> {
  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  rejectUnknown(context.body, ['expectedRevision'])
  const expectedRevision = requirePositiveInteger(context.body.expectedRevision)
  const current = await header(env.DB, version)
  if (!current) fail(404, 'BENCHMARK_NOT_FOUND', 'The benchmark set does not exist.')
  if (current.status !== 'draft') fail(409, 'BENCHMARK_IMMUTABLE', 'Published benchmark sets cannot be changed.')
  if (current.revision_no !== expectedRevision) fail(409, 'REVISION_CONFLICT', 'The benchmark draft changed before publication.')
  const document = await loadDocument(env.DB, current)
  const { validation: checked, preview } = validationProjection(document)
  const fingerprint = await fingerprintExpertBenchmarkContent(document)
  if (checked.errors.length || current.validation_status !== 'valid' || current.content_fingerprint !== fingerprint) {
    fail(409, 'VALIDATION_STALE', 'A current valid validation is required before publication.')
  }
  const last = await env.DB.prepare(`SELECT revision_no,content_fingerprint,validation_status FROM analysis_validation_runs
    WHERE object_type='benchmark' AND object_version=? ORDER BY validated_at DESC LIMIT 1`).bind(version).first<{
      revision_no: number; content_fingerprint: string; validation_status: string
    }>()
  if (!last || last.revision_no !== expectedRevision || last.validation_status !== 'valid' || last.content_fingerprint !== fingerprint) {
    fail(409, 'VALIDATION_STALE', 'The latest validation does not match the current draft.')
  }
  const now = new Date().toISOString()
  const data = { version, status: 'published', revision: expectedRevision, expertCount: document.experts.length, fingerprint, candidateValues: preview.candidates }
  const guard = `SELECT 1 FROM benchmark_sets WHERE benchmark_version=? AND status='draft' AND revision_no=${expectedRevision}`
  const statements: D1PreparedStatement[] = []
  for (const candidateId of analysisCandidateIds) {
    const policy = document.candidatePolicies.find((entry) => entry.candidateId === candidateId)!
    const stats = sampleMeanAndSd(document.experts.map((expert) => expert.scores[candidateId]))!
    statements.push(env.DB.prepare(`INSERT INTO benchmark_candidate_values
      (benchmark_version,candidate_id,benchmark_value,benchmark_sd,direction,include_in_core_eac,source_note,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (${guard})`).bind(version, candidateId, stats.mean, stats.sampleSd, policy.direction, policy.includeInCoreEac ? 1 : 0, 'expert_panel_mean_sample_sd', now, version))
  }
  statements.push(
    env.DB.prepare(`UPDATE benchmark_sets SET status='published',is_provisional=0,expert_count=?,rated_at=?,published_at=?,published_by_admin_user_id=?,updated_at=?,write_token=?
      WHERE benchmark_version=? AND status='draft' AND revision_no=? AND validation_status='valid' AND content_fingerprint=?`).bind(document.experts.length, document.ratedAt, now, context.admin.adminUserId, now, context.key, version, expectedRevision, fingerprint),
    auditStatement(env.DB, context, 'benchmark_set_published', version, now, { version, revision: expectedRevision, contentFingerprint: fingerprint, warningCount: checked.warnings.length, errorCount: 0 }, `WHERE EXISTS (SELECT 1 FROM benchmark_sets WHERE benchmark_version=? AND status='published' AND write_token=?)`, [version, context.key]),
    receiptStatement(env.DB, context, 'benchmark_set_published', version, data, now, `WHERE EXISTS (SELECT 1 FROM benchmark_sets WHERE benchmark_version=? AND status='published' AND write_token=?)`, [version, context.key]),
  )
  const results = await env.DB.batch(statements)
  if (results[5].meta.changes !== 1) fail(409, 'PUBLISH_CONFLICT', 'The benchmark could not be published because the draft changed.')
  return adminSuccessResponse(data, requestId)
}

export async function handleAdminAnalysis(request: Request, env: Env, requestId: string): Promise<Response> {
  try {
    const path = new URL(request.url).pathname
    const prefix = '/api/admin/analysis/benchmark-sets'
    if (!path.startsWith(prefix)) fail(404, 'NOT_FOUND', 'The requested analysis endpoint does not exist.')
    const suffix = path.slice(prefix.length).replace(/^\//, '')
    const segments = suffix ? suffix.split('/').map(decodeURIComponent) : []
    if (segments.length === 0) {
      if (request.method === 'GET') return await list(request, env, requestId)
      if (request.method === 'POST') return await create(request, env, requestId)
      fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
    }
    const version = requireVersion(segments[0], 'version')
    if (segments.length === 1 && request.method === 'GET') return await getOne(request, env, requestId, version)
    if (segments.length === 1 && request.method === 'PUT') return await update(request, env, requestId, version)
    if (segments.length === 2 && segments[1] === 'validate' && request.method === 'POST') return await validate(request, env, requestId, version)
    if (segments.length === 2 && segments[1] === 'publish' && request.method === 'POST') return await publish(request, env, requestId, version)
    fail(404, 'NOT_FOUND', 'The requested analysis endpoint does not exist.')
  } catch (error) {
    if (error instanceof AnalysisError || error instanceof AdminAuthError || error instanceof AdminCsrfError) {
      return adminErrorResponse(error.status, { code: error.code, message: error.message }, requestId)
    }
    return adminErrorResponse(500, { code: 'ADMIN_ANALYSIS_FAILED', message: 'The benchmark administration request could not be completed.' }, requestId)
  }
}
