import { AdminAuthError, authenticateAdmin, type AdminContext } from '../auth/adminAuth'
import {
  isConfigurationVersion,
  validateMaterialDocument,
  validatePointRule,
  validateSunkCostRule,
  type ConfigurationIssue,
  type MaterialDocument,
} from '../domain/configuration'
import {
  fingerprintConfiguration,
  fingerprintMaterial,
  fingerprintPointRule,
  fingerprintRequest,
  fingerprintSunkCostRule,
} from '../domain/configurationFingerprint'
import type { Env } from '../env'
import { adminErrorResponse, adminSuccessResponse } from '../http/adminResponses'
import { AdminCsrfError, requireAdminCsrf } from '../security/adminCsrf'
import { adminAuditStatement, type AdminAuditAction } from '../services/adminAudit'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_CONFIG_BODY_BYTES = 262_144

class AdminConfigurationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AdminConfigurationError'
  }
}

type WriteContext = {
  admin: AdminContext
  body: Record<string, unknown>
  key: string
  requestHash: string
  replay: { status: number; data: unknown } | null
}

function requireFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  if (Object.keys(body).some((key) => !allowedSet.has(key))) {
    throw new AdminConfigurationError(400, 'CONFIG_REQUEST_INVALID', 'The configuration request contains unknown fields.')
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AdminConfigurationError(400, 'CONFIG_REQUEST_INVALID', `${field} is required.`)
  }
  return value.trim()
}

function requiredRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new AdminConfigurationError(400, 'CONFIG_REQUEST_INVALID', 'expectedRevision must be a positive integer.')
  }
  return value as number
}

async function readWriteContext(
  request: Request,
  env: Env,
  requestId: string,
): Promise<WriteContext> {
  const admin = await authenticateAdmin(request, env, { requestId })
  await requireAdminCsrf(request, admin)
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new AdminConfigurationError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Configuration writes require application/json.')
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_CONFIG_BODY_BYTES) {
    throw new AdminConfigurationError(413, 'CONFIG_REQUEST_TOO_LARGE', 'The configuration request is too large.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_CONFIG_BODY_BYTES) {
    throw new AdminConfigurationError(413, 'CONFIG_REQUEST_TOO_LARGE', 'The configuration request is too large.')
  }
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new AdminConfigurationError(400, 'CONFIG_REQUEST_INVALID', 'The configuration request must be valid JSON.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AdminConfigurationError(400, 'CONFIG_REQUEST_INVALID', 'The configuration request must be a JSON object.')
  }
  const key = request.headers.get('Idempotency-Key') ?? ''
  if (!UUID_PATTERN.test(key)) {
    throw new AdminConfigurationError(400, 'IDEMPOTENCY_KEY_INVALID', 'A UUID Idempotency-Key is required.')
  }
  const requestHash = await fingerprintRequest({
    method: request.method,
    path: new URL(request.url).pathname,
    body,
  })
  const receipt = await env.DB.prepare(
    `SELECT admin_user_id,request_hash,response_status,response_json
     FROM admin_operation_receipts WHERE idempotency_key = ?`,
  ).bind(key).first<{
    admin_user_id: string
    request_hash: string
    response_status: number
    response_json: string
  }>()
  if (receipt) {
    if (receipt.admin_user_id !== admin.adminUserId || receipt.request_hash !== requestHash) {
      throw new AdminConfigurationError(409, 'IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was already used for a different request.')
    }
    return { admin, body: body as Record<string, unknown>, key, requestHash, replay: {
      status: receipt.response_status,
      data: JSON.parse(receipt.response_json),
    } }
  }
  return { admin, body: body as Record<string, unknown>, key, requestHash, replay: null }
}

function receiptStatement(
  db: D1Database,
  context: WriteContext,
  action: string,
  targetType: string,
  targetId: string | null,
  status: number,
  data: unknown,
  now: string,
): D1PreparedStatement {
  return db.prepare(`INSERT INTO admin_operation_receipts (
    idempotency_key,admin_user_id,action,target_type,target_id,request_hash,
    response_status,response_json,created_at
  ) VALUES (?,?,?,?,?,?,?,json(?),?)`).bind(
    context.key, context.admin.adminUserId, action, targetType, targetId,
    context.requestHash, status, JSON.stringify(data), now,
  )
}

async function commitWrite(
  env: Env,
  requestId: string,
  context: WriteContext,
  options: {
    statements: D1PreparedStatement[]
    action: AdminAuditAction
    targetType: string
    targetId: string
    status?: number
    data: unknown
    metadata?: Record<string, unknown>
  },
): Promise<Response> {
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  const now = new Date().toISOString()
  const status = options.status ?? 200
  const statements = [
    ...options.statements,
    adminAuditStatement(env.DB, {
      adminUserId: context.admin.adminUserId,
      adminSessionId: context.admin.adminSessionId,
      action: options.action,
      outcome: 'success',
      targetType: options.targetType,
      targetId: options.targetId,
      requestId,
      clientFingerprintHash: context.admin.clientFingerprintHash,
      metadata: options.metadata,
      createdAt: now,
    }),
    receiptStatement(env.DB, context, options.action, options.targetType, options.targetId, status, options.data, now),
  ]
  try {
    await env.DB.batch(statements)
  } catch (error) {
    const receipt = await env.DB.prepare(
      'SELECT request_hash,response_status,response_json FROM admin_operation_receipts WHERE idempotency_key=?',
    ).bind(context.key).first<{ request_hash: string; response_status: number; response_json: string }>()
    if (receipt?.request_hash === context.requestHash) {
      return adminSuccessResponse(JSON.parse(receipt.response_json), requestId, receipt.response_status)
    }
    throw error
  }
  return adminSuccessResponse(options.data, requestId, status)
}

type MaterialHeader = {
  material_version: string
  display_name: string
  status: 'draft' | 'published' | 'retired'
  source_material_version: string | null
  revision_no: number
  validation_status: string
  validation_report_json: string
  content_fingerprint: string | null
  published_at: string | null
}

async function loadMaterialDocument(db: D1Database, version: string): Promise<MaterialDocument> {
  const profiles = await db.prepare(`SELECT candidate_id,display_order,name,role,school,
    visible_halo_json,resume_summary,education,skills_json,experiences_json,
    initial_image,public_tags_json FROM candidate_material_profiles
    WHERE material_version=? ORDER BY candidate_id`).bind(version).all<Record<string, string | number>>()
  const evidence = await db.prepare(`SELECT evidence_id,candidate_id,evidence_level,
    item_order,title,content,polarity,is_key_risk FROM candidate_evidence_items
    WHERE material_version=? ORDER BY candidate_id,evidence_level,item_order`).bind(version)
    .all<Record<string, string | number>>()
  return {
    profiles: profiles.results.map((row) => ({
      candidateId: String(row.candidate_id), displayOrder: Number(row.display_order),
      name: String(row.name), role: String(row.role), school: String(row.school),
      visibleHalo: JSON.parse(String(row.visible_halo_json)) as string[],
      resumeSummary: String(row.resume_summary), education: String(row.education),
      skills: JSON.parse(String(row.skills_json)) as string[],
      experiences: JSON.parse(String(row.experiences_json)) as Array<{ title: string; content: string }>,
      initialImage: String(row.initial_image),
      publicTags: JSON.parse(String(row.public_tags_json)) as string[],
    })),
    evidence: evidence.results.map((row) => ({
      evidenceId: String(row.evidence_id), candidateId: String(row.candidate_id),
      level: String(row.evidence_level) as 'shallow' | 'deep', order: Number(row.item_order),
      title: String(row.title), content: String(row.content),
      polarity: String(row.polarity) as 'positive' | 'negative', isKeyRisk: row.is_key_risk === 1,
    })),
  }
}

function materialProjection(header: MaterialHeader, document?: MaterialDocument) {
  return {
    version: header.material_version,
    displayName: header.display_name,
    status: header.status,
    sourceVersion: header.source_material_version,
    revision: header.revision_no,
    validationStatus: header.validation_status,
    validationReport: JSON.parse(header.validation_report_json),
    fingerprint: header.content_fingerprint,
    publishedAt: header.published_at,
    ...(document ?? {}),
  }
}

async function materialRoute(
  request: Request,
  env: Env,
  requestId: string,
  segments: string[],
): Promise<Response> {
  if (request.method === 'GET') {
    await authenticateAdmin(request, env, { requestId })
    if (segments.length === 0) {
      const result = await env.DB.prepare(`SELECT m.material_version,m.display_name,m.status,
        m.source_material_version,m.revision_no,m.validation_status,m.published_at,
        EXISTS(SELECT 1 FROM configuration_sets c WHERE c.is_active=1
          AND c.material_version=m.material_version) AS used_by_active
        FROM material_sets m ORDER BY m.created_at DESC,m.material_version`).all<Record<string, string | number | null>>()
      return adminSuccessResponse({ items: result.results.map((row) => ({
        version: row.material_version, displayName: row.display_name, status: row.status,
        sourceVersion: row.source_material_version, revision: row.revision_no,
        validationStatus: row.validation_status, publishedAt: row.published_at,
        usedByActiveConfig: row.used_by_active === 1,
      })) }, requestId)
    }
    if (segments.length === 1) {
      const header = await env.DB.prepare('SELECT * FROM material_sets WHERE material_version=?')
        .bind(segments[0]).first<MaterialHeader>()
      if (!header) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The material version does not exist.')
      return adminSuccessResponse(materialProjection(header, await loadMaterialDocument(env.DB, segments[0])), requestId)
    }
  }

  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  if (request.method === 'POST' && segments.length === 0) {
    requireFields(context.body, ['version', 'displayName', 'cloneFromVersion'])
    const version = requiredText(context.body.version, 'version')
    const displayName = requiredText(context.body.displayName, 'displayName')
    const source = requiredText(context.body.cloneFromVersion, 'cloneFromVersion')
    if (!isConfigurationVersion(version)) throw new AdminConfigurationError(400, 'CONFIG_VERSION_INVALID', 'The material version ID is invalid.')
    const sourceRow = await env.DB.prepare("SELECT status FROM material_sets WHERE material_version=?")
      .bind(source).first<{ status: string }>()
    if (!sourceRow) throw new AdminConfigurationError(404, 'CONFIG_SOURCE_NOT_FOUND', 'The source material version does not exist.')
    if (sourceRow.status !== 'published') throw new AdminConfigurationError(409, 'CONFIG_SOURCE_NOT_PUBLISHED', 'Only a published material version can be cloned.')
    const now = new Date().toISOString()
    const data = { version, displayName, sourceVersion: source, status: 'draft', revision: 1, validationStatus: 'not_validated' }
    return commitWrite(env, requestId, context, {
      action: 'material_set_created', targetType: 'material_set', targetId: version,
      status: 201, data, metadata: { version, revision: 1, validationStatus: 'not_validated' },
      statements: [
        env.DB.prepare(`INSERT INTO material_sets (
          material_version,display_name,status,source_material_version,revision_no,
          validation_status,validation_report_json,created_by_admin_user_id,
          updated_by_admin_user_id,created_at,updated_at
        ) VALUES (?,?,'draft',?,1,'not_validated',json('{"errors":[],"warnings":[]}'),?,?,?,?)`)
          .bind(version, displayName, source, context.admin.adminUserId, context.admin.adminUserId, now, now),
        env.DB.prepare(`INSERT INTO candidate_material_profiles (
          material_version,candidate_id,display_order,name,role,school,visible_halo_json,
          resume_summary,education,skills_json,experiences_json,initial_image,
          public_tags_json,created_at,updated_at
        ) SELECT ?,candidate_id,display_order,name,role,school,visible_halo_json,
          resume_summary,education,skills_json,experiences_json,initial_image,
          public_tags_json,?,? FROM candidate_material_profiles WHERE material_version=?`)
          .bind(version, now, now, source),
        env.DB.prepare(`INSERT INTO candidate_evidence_items (
          material_version,evidence_id,candidate_id,evidence_level,item_order,title,
          content,polarity,is_key_risk,created_at,updated_at
        ) SELECT ?,evidence_id,candidate_id,evidence_level,item_order,title,content,
          polarity,is_key_risk,?,? FROM candidate_evidence_items WHERE material_version=?`)
          .bind(version, now, now, source),
      ],
    })
  }
  if (request.method === 'PUT' && segments.length === 1) {
    requireFields(context.body, ['expectedRevision', 'displayName', 'document'])
    const expectedRevision = requiredRevision(context.body.expectedRevision)
    const displayName = requiredText(context.body.displayName, 'displayName')
    const errors = validateMaterialDocument(context.body.document)
    if (errors.length) throw new AdminConfigurationError(400, 'MATERIAL_DOCUMENT_INVALID', JSON.stringify(errors))
    const document = context.body.document as MaterialDocument
    const header = await env.DB.prepare('SELECT * FROM material_sets WHERE material_version=?')
      .bind(segments[0]).first<MaterialHeader>()
    if (!header) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The material version does not exist.')
    if (header.status !== 'draft') throw new AdminConfigurationError(409, 'CONFIG_VERSION_IMMUTABLE', 'Published configuration versions cannot be changed.')
    if (header.revision_no !== expectedRevision) throw new AdminConfigurationError(409, 'CONFIG_REVISION_CONFLICT', 'The material draft was changed in another editor.')
    const existingEvidence = await env.DB.prepare(
      'SELECT evidence_id FROM candidate_evidence_items WHERE material_version=? ORDER BY evidence_id',
    ).bind(segments[0]).all<{ evidence_id: string }>()
    const currentIds = existingEvidence.results.map(({ evidence_id }) => evidence_id).sort()
    const nextIds = document.evidence.map(({ evidenceId }) => evidenceId).sort()
    if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
      throw new AdminConfigurationError(400, 'EVIDENCE_ID_IMMUTABLE', 'Evidence IDs cannot be renamed or replaced within a draft version.')
    }
    const revision = expectedRevision + 1
    const now = new Date().toISOString()
    const statements: D1PreparedStatement[] = [
      env.DB.prepare('DELETE FROM candidate_material_profiles WHERE material_version=?').bind(segments[0]),
      env.DB.prepare('DELETE FROM candidate_evidence_items WHERE material_version=?').bind(segments[0]),
    ]
    for (const profile of document.profiles) {
      statements.push(env.DB.prepare(`INSERT INTO candidate_material_profiles (
        material_version,candidate_id,display_order,name,role,school,visible_halo_json,
        resume_summary,education,skills_json,experiences_json,initial_image,public_tags_json,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,?,json(?),?,?,json(?),json(?),?,json(?),?,?)`).bind(
        segments[0], profile.candidateId, profile.displayOrder, profile.name, profile.role,
        profile.school, JSON.stringify(profile.visibleHalo), profile.resumeSummary,
        profile.education, JSON.stringify(profile.skills), JSON.stringify(profile.experiences),
        profile.initialImage, JSON.stringify(profile.publicTags), now, now,
      ))
    }
    for (const item of document.evidence) {
      statements.push(env.DB.prepare(`INSERT INTO candidate_evidence_items (
        material_version,evidence_id,candidate_id,evidence_level,item_order,title,
        content,polarity,is_key_risk,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
        segments[0], item.evidenceId, item.candidateId, item.level, item.order,
        item.title, item.content, item.polarity, item.isKeyRisk ? 1 : 0, now, now,
      ))
    }
    statements.push(env.DB.prepare(`UPDATE material_sets SET display_name=?,revision_no=?,
      validation_status='stale',content_fingerprint=NULL,updated_by_admin_user_id=?,
      updated_at=?,validated_at=NULL WHERE material_version=? AND status='draft' AND revision_no=?`)
      .bind(displayName, revision, context.admin.adminUserId, now, segments[0], expectedRevision))
    const data = { version: segments[0], displayName, status: 'draft', revision, validationStatus: 'stale' }
    return commitWrite(env, requestId, context, {
      action: 'material_set_updated', targetType: 'material_set', targetId: segments[0],
      data, metadata: { version: segments[0], revision, validationStatus: 'stale' }, statements,
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'validate') {
    requireFields(context.body, [])
    const header = await env.DB.prepare('SELECT * FROM material_sets WHERE material_version=?')
      .bind(segments[0]).first<MaterialHeader>()
    if (!header) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The material version does not exist.')
    if (header.status !== 'draft') throw new AdminConfigurationError(409, 'CONFIG_VERSION_IMMUTABLE', 'Published configuration versions cannot be revalidated.')
    const document = await loadMaterialDocument(env.DB, segments[0])
    const errors = validateMaterialDocument(document)
    const warnings: ConfigurationIssue[] = []
    const fingerprint = await fingerprintMaterial(document as unknown as { profiles: Array<Record<string, unknown>>; evidence: Array<Record<string, unknown>> })
    const status = errors.length ? 'invalid' : 'valid'
    const report = { errors, warnings }
    const now = new Date().toISOString()
    const data = { version: segments[0], revision: header.revision_no, validationStatus: status, errors, warnings, fingerprint }
    return commitWrite(env, requestId, context, {
      action: 'material_set_validated', targetType: 'material_set', targetId: segments[0], data,
      metadata: { version: segments[0], revision: header.revision_no, validationStatus: status,
        contentFingerprint: fingerprint, warningCount: 0, errorCount: errors.length },
      statements: [
        env.DB.prepare(`INSERT INTO configuration_validation_runs (
          validation_run_id,target_type,target_version,target_revision,validation_status,
          errors_json,warnings_json,content_fingerprint,admin_user_id,request_id,created_at
        ) VALUES (?,'material_set',?,?,?,json(?),json(?),?,?,?,?)`).bind(
          crypto.randomUUID(), segments[0], header.revision_no, status,
          JSON.stringify(errors), JSON.stringify(warnings), fingerprint,
          context.admin.adminUserId, requestId, now,
        ),
        env.DB.prepare(`UPDATE material_sets SET validation_status=?,validation_report_json=json(?),
          content_fingerprint=?,validated_at=?,updated_at=?,updated_by_admin_user_id=?
          WHERE material_version=?`).bind(status, JSON.stringify(report), fingerprint, now, now,
          context.admin.adminUserId, segments[0]),
      ],
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'publish') {
    requireFields(context.body, [])
    const header = await env.DB.prepare('SELECT * FROM material_sets WHERE material_version=?')
      .bind(segments[0]).first<MaterialHeader>()
    if (!header) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The material version does not exist.')
    if (header.status === 'published') {
      const data = materialProjection(header)
      return commitWrite(env, requestId, context, { action: 'material_set_published', targetType: 'material_set', targetId: segments[0], data, statements: [] })
    }
    if (header.status !== 'draft' || header.validation_status !== 'valid' || !header.content_fingerprint) {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_REQUIRED', 'The current draft revision must pass validation before publication.')
    }
    const latest = await env.DB.prepare(`SELECT target_revision,content_fingerprint,validation_status
      FROM configuration_validation_runs WHERE target_type='material_set' AND target_version=?
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(segments[0]).first<{
        target_revision: number; content_fingerprint: string; validation_status: string
      }>()
    if (!latest || latest.target_revision !== header.revision_no || latest.content_fingerprint !== header.content_fingerprint || latest.validation_status !== 'valid') {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_STALE', 'The latest validation no longer matches this draft.')
    }
    const now = new Date().toISOString()
    const data = { ...materialProjection(header), status: 'published', publishedAt: now }
    return commitWrite(env, requestId, context, {
      action: 'material_set_published', targetType: 'material_set', targetId: segments[0], data,
      metadata: { version: segments[0], revision: header.revision_no, validationStatus: 'valid', contentFingerprint: header.content_fingerprint },
      statements: [env.DB.prepare(`UPDATE material_sets SET status='published',published_by_admin_user_id=?,
        published_at=?,updated_at=? WHERE material_version=? AND status='draft'`)
        .bind(context.admin.adminUserId, now, now, segments[0])],
    })
  }
  throw new AdminConfigurationError(404, 'NOT_FOUND', 'The requested configuration endpoint does not exist.')
}

type RuleKind = 'point' | 'sunk'

type PointRuleRow = {
  point_rule_version: string
  display_name: string
  source_point_rule_version: string | null
  total_points: number
  shallow_cost: number
  deep_cost: number
  status: 'draft' | 'published' | 'retired'
  revision_no: number
  validation_status: string
  validation_report_json: string
  content_fingerprint: string | null
  published_at: string | null
}

type SunkRuleRow = {
  sunk_cost_rule_version: string
  display_name: string
  source_sunk_cost_rule_version: string | null
  trigger_remaining_sec: number
  minimum_candidate_investment: number
  requires_key_risk: number
  status: 'draft' | 'published' | 'retired'
  revision_no: number
  validation_status: string
  validation_report_json: string
  content_fingerprint: string | null
  published_at: string | null
}

function pointProjection(row: PointRuleRow) {
  return {
    version: row.point_rule_version, displayName: row.display_name,
    sourceVersion: row.source_point_rule_version, status: row.status,
    revision: row.revision_no, validationStatus: row.validation_status,
    validationReport: JSON.parse(row.validation_report_json), fingerprint: row.content_fingerprint,
    publishedAt: row.published_at,
    rule: { totalPoints: row.total_points, shallowCost: row.shallow_cost, deepCost: row.deep_cost },
  }
}

function sunkProjection(row: SunkRuleRow) {
  return {
    version: row.sunk_cost_rule_version, displayName: row.display_name,
    sourceVersion: row.source_sunk_cost_rule_version, status: row.status,
    revision: row.revision_no, validationStatus: row.validation_status,
    validationReport: JSON.parse(row.validation_report_json), fingerprint: row.content_fingerprint,
    publishedAt: row.published_at,
    rule: {
      triggerRemainingSec: row.trigger_remaining_sec,
      minimumCandidateInvestment: row.minimum_candidate_investment,
      requiresKeyRisk: row.requires_key_risk === 1,
    },
  }
}

async function ruleRoute(
  kind: RuleKind,
  request: Request,
  env: Env,
  requestId: string,
  segments: string[],
): Promise<Response> {
  const isPoint = kind === 'point'
  const table = isPoint ? 'point_rules' : 'sunk_cost_rules'
  const versionColumn = isPoint ? 'point_rule_version' : 'sunk_cost_rule_version'
  const sourceColumn = isPoint ? 'source_point_rule_version' : 'source_sunk_cost_rule_version'
  const targetType = isPoint ? 'point_rule' : 'sunk_cost_rule'
  const actionPrefix = isPoint ? 'point_rule' : 'sunk_cost_rule'
  if (request.method === 'GET') {
    await authenticateAdmin(request, env, { requestId })
    if (segments.length === 0) {
      const result = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC,${versionColumn}`).all<Record<string, unknown>>()
      return adminSuccessResponse({ items: result.results.map((item) => isPoint
        ? pointProjection(item as unknown as PointRuleRow)
        : sunkProjection(item as unknown as SunkRuleRow)) }, requestId)
    }
    if (segments.length === 1) {
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${versionColumn}=?`)
        .bind(segments[0]).first<Record<string, unknown>>()
      if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The rule version does not exist.')
      return adminSuccessResponse(isPoint
        ? pointProjection(row as unknown as PointRuleRow)
        : sunkProjection(row as unknown as SunkRuleRow), requestId)
    }
  }
  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  if (request.method === 'POST' && segments.length === 0) {
    requireFields(context.body, ['version', 'displayName', 'cloneFromVersion'])
    const version = requiredText(context.body.version, 'version')
    const displayName = requiredText(context.body.displayName, 'displayName')
    const source = requiredText(context.body.cloneFromVersion, 'cloneFromVersion')
    if (!isConfigurationVersion(version)) throw new AdminConfigurationError(400, 'CONFIG_VERSION_INVALID', 'The rule version ID is invalid.')
    const sourceRow = await env.DB.prepare(`SELECT status FROM ${table} WHERE ${versionColumn}=?`)
      .bind(source).first<{ status: string }>()
    if (!sourceRow) throw new AdminConfigurationError(404, 'CONFIG_SOURCE_NOT_FOUND', 'The source rule version does not exist.')
    if (sourceRow.status !== 'published') throw new AdminConfigurationError(409, 'CONFIG_SOURCE_NOT_PUBLISHED', 'Only published rules can be cloned.')
    const now = new Date().toISOString()
    const data = { version, displayName, sourceVersion: source, status: 'draft', revision: 1, validationStatus: 'not_validated' }
    const values = isPoint ? 'total_points,shallow_cost,deep_cost' : 'trigger_remaining_sec,minimum_candidate_investment,requires_key_risk'
    return commitWrite(env, requestId, context, {
      action: `${actionPrefix}_created` as AdminAuditAction, targetType, targetId: version,
      status: 201, data, metadata: { version, revision: 1, validationStatus: 'not_validated' },
      statements: [env.DB.prepare(`INSERT INTO ${table} (
        ${versionColumn},display_name,${sourceColumn},${values},status,revision_no,
        validation_status,validation_report_json,created_by_admin_user_id,
        updated_by_admin_user_id,created_at,updated_at
      ) SELECT ?,?,?,${values},'draft',1,'not_validated',json('{"errors":[],"warnings":[]}'),?,?,?,?
        FROM ${table} WHERE ${versionColumn}=?`).bind(
          version, displayName, source, context.admin.adminUserId, context.admin.adminUserId,
          now, now, source,
        )],
    })
  }
  if (request.method === 'PUT' && segments.length === 1) {
    requireFields(context.body, ['expectedRevision', 'displayName', 'rule'])
    const expectedRevision = requiredRevision(context.body.expectedRevision)
    const displayName = requiredText(context.body.displayName, 'displayName')
    if (!context.body.rule || typeof context.body.rule !== 'object' || Array.isArray(context.body.rule)) {
      throw new AdminConfigurationError(400, 'CONFIG_REQUEST_INVALID', 'A rule object is required.')
    }
    const rule = context.body.rule as Record<string, unknown>
    requireFields(rule, isPoint
      ? ['totalPoints', 'shallowCost', 'deepCost']
      : ['triggerRemainingSec', 'minimumCandidateInvestment', 'requiresKeyRisk'])
    const errors = isPoint
      ? validatePointRule({ totalPoints: rule.totalPoints, shallowCost: rule.shallowCost, deepCost: rule.deepCost })
      : validateSunkCostRule({ triggerRemainingSec: rule.triggerRemainingSec, minimumCandidateInvestment: rule.minimumCandidateInvestment, requiresKeyRisk: rule.requiresKeyRisk })
    if (errors.length) throw new AdminConfigurationError(400, 'RULE_INVALID', JSON.stringify(errors))
    const row = await env.DB.prepare(`SELECT status,revision_no FROM ${table} WHERE ${versionColumn}=?`)
      .bind(segments[0]).first<{ status: string; revision_no: number }>()
    if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The rule version does not exist.')
    if (row.status !== 'draft') throw new AdminConfigurationError(409, 'CONFIG_VERSION_IMMUTABLE', 'Published configuration versions cannot be changed.')
    if (row.revision_no !== expectedRevision) throw new AdminConfigurationError(409, 'CONFIG_REVISION_CONFLICT', 'The rule draft was changed in another editor.')
    const revision = expectedRevision + 1
    const now = new Date().toISOString()
    const assignments = isPoint
      ? 'total_points=?,shallow_cost=?,deep_cost=?'
      : 'trigger_remaining_sec=?,minimum_candidate_investment=?,requires_key_risk=?'
    const ruleBindings = isPoint
      ? [rule.totalPoints, rule.shallowCost, rule.deepCost]
      : [rule.triggerRemainingSec, rule.minimumCandidateInvestment, rule.requiresKeyRisk === true ? 1 : 0]
    const data = { version: segments[0], displayName, status: 'draft', revision, validationStatus: 'stale', rule }
    return commitWrite(env, requestId, context, {
      action: `${actionPrefix}_updated` as AdminAuditAction, targetType, targetId: segments[0], data,
      metadata: { version: segments[0], revision, validationStatus: 'stale' },
      statements: [env.DB.prepare(`UPDATE ${table} SET display_name=?,${assignments},
        revision_no=?,validation_status='stale',content_fingerprint=NULL,
        updated_by_admin_user_id=?,updated_at=?,validated_at=NULL
        WHERE ${versionColumn}=? AND status='draft' AND revision_no=?`).bind(
          displayName, ...ruleBindings, revision, context.admin.adminUserId, now,
          segments[0], expectedRevision,
        )],
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'validate') {
    requireFields(context.body, [])
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${versionColumn}=?`)
      .bind(segments[0]).first<Record<string, unknown>>()
    if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The rule version does not exist.')
    if (row.status !== 'draft') throw new AdminConfigurationError(409, 'CONFIG_VERSION_IMMUTABLE', 'Published configuration versions cannot be revalidated.')
    const projection = isPoint
      ? pointProjection(row as unknown as PointRuleRow)
      : sunkProjection(row as unknown as SunkRuleRow)
    const errors = isPoint
      ? validatePointRule((projection as ReturnType<typeof pointProjection>).rule)
      : validateSunkCostRule((projection as ReturnType<typeof sunkProjection>).rule)
    const warnings: ConfigurationIssue[] = []
    const fingerprint = isPoint
      ? await fingerprintPointRule((projection as ReturnType<typeof pointProjection>).rule)
      : await fingerprintSunkCostRule((projection as ReturnType<typeof sunkProjection>).rule)
    const validationStatus = errors.length ? 'invalid' : 'valid'
    const revision = Number(row.revision_no)
    const now = new Date().toISOString()
    const data = { version: segments[0], revision, validationStatus, errors, warnings, fingerprint }
    return commitWrite(env, requestId, context, {
      action: `${actionPrefix}_validated` as AdminAuditAction, targetType, targetId: segments[0], data,
      metadata: { version: segments[0], revision, validationStatus, contentFingerprint: fingerprint, warningCount: 0, errorCount: errors.length },
      statements: [
        env.DB.prepare(`INSERT INTO configuration_validation_runs (
          validation_run_id,target_type,target_version,target_revision,validation_status,
          errors_json,warnings_json,content_fingerprint,admin_user_id,request_id,created_at
        ) VALUES (?,?,?,?,?,json(?),json(?),?,?,?,?)`).bind(
          crypto.randomUUID(), targetType, segments[0], revision, validationStatus,
          JSON.stringify(errors), JSON.stringify(warnings), fingerprint,
          context.admin.adminUserId, requestId, now,
        ),
        env.DB.prepare(`UPDATE ${table} SET validation_status=?,validation_report_json=json(?),
          content_fingerprint=?,validated_at=?,updated_at=?,updated_by_admin_user_id=?
          WHERE ${versionColumn}=?`).bind(validationStatus, JSON.stringify({ errors, warnings }),
          fingerprint, now, now, context.admin.adminUserId, segments[0]),
      ],
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'publish') {
    requireFields(context.body, [])
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${versionColumn}=?`)
      .bind(segments[0]).first<Record<string, unknown>>()
    if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The rule version does not exist.')
    const projected = isPoint ? pointProjection(row as unknown as PointRuleRow) : sunkProjection(row as unknown as SunkRuleRow)
    if (projected.status === 'published') {
      return commitWrite(env, requestId, context, {
        action: `${actionPrefix}_published` as AdminAuditAction, targetType, targetId: segments[0], data: projected, statements: [],
      })
    }
    if (projected.status !== 'draft' || projected.validationStatus !== 'valid' || !projected.fingerprint) {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_REQUIRED', 'The current rule draft must pass validation before publication.')
    }
    const latest = await env.DB.prepare(`SELECT target_revision,content_fingerprint,validation_status
      FROM configuration_validation_runs WHERE target_type=? AND target_version=?
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(targetType, segments[0])
      .first<{ target_revision: number; content_fingerprint: string; validation_status: string }>()
    if (!latest || latest.target_revision !== projected.revision || latest.content_fingerprint !== projected.fingerprint || latest.validation_status !== 'valid') {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_STALE', 'The latest validation no longer matches this rule draft.')
    }
    const now = new Date().toISOString()
    const data = { ...projected, status: 'published', publishedAt: now }
    return commitWrite(env, requestId, context, {
      action: `${actionPrefix}_published` as AdminAuditAction, targetType, targetId: segments[0], data,
      metadata: { version: segments[0], revision: projected.revision, validationStatus: 'valid', contentFingerprint: projected.fingerprint },
      statements: [env.DB.prepare(`UPDATE ${table} SET status='published',published_by_admin_user_id=?,
        published_at=?,updated_at=? WHERE ${versionColumn}=? AND status='draft'`)
        .bind(context.admin.adminUserId, now, now, segments[0])],
    })
  }
  throw new AdminConfigurationError(404, 'NOT_FOUND', 'The requested configuration endpoint does not exist.')
}

type ConfigRow = {
  config_set_id: string
  display_name: string
  source_config_set_id: string | null
  task_version: string
  material_version: string
  point_rule_version: string
  sunk_cost_rule_version: string
  scoring_version: string
  benchmark_version: string
  norm_version: string | null
  status: 'draft' | 'published' | 'retired'
  is_active: number
  revision_no: number
  validation_status: string
  validation_report_json: string
  config_fingerprint: string | null
  published_at: string | null
  activated_at: string | null
}

function configProjection(row: ConfigRow) {
  return {
    configSetId: row.config_set_id, displayName: row.display_name,
    sourceConfigSetId: row.source_config_set_id, status: row.status,
    active: row.is_active === 1, revision: row.revision_no,
    validationStatus: row.validation_status,
    validationReport: JSON.parse(row.validation_report_json), fingerprint: row.config_fingerprint,
    taskVersion: row.task_version, materialVersion: row.material_version,
    pointRuleVersion: row.point_rule_version, sunkCostRuleVersion: row.sunk_cost_rule_version,
    scoringVersion: row.scoring_version, benchmarkVersion: row.benchmark_version,
    normVersion: row.norm_version, publishedAt: row.published_at, activatedAt: row.activated_at,
  }
}

async function validateConfigurationSet(db: D1Database, row: ConfigRow): Promise<{
  errors: ConfigurationIssue[]
  warnings: ConfigurationIssue[]
  fingerprint: string
}> {
  const errors: ConfigurationIssue[] = []
  const warnings: ConfigurationIssue[] = []
  const add = (code: string, path: string, message: string) => errors.push({ code, path, message })
  if (row.task_version !== 'task-1.0.0') add('TASK_VERSION_INVALID', 'taskVersion', 'The task version does not exist.')
  if (row.norm_version !== null) add('NORM_VERSION_UNSUPPORTED', 'normVersion', 'Norm versions are not available in Stage 10A.')
  const material = await db.prepare('SELECT status,content_fingerprint FROM material_sets WHERE material_version=?')
    .bind(row.material_version).first<{ status: string; content_fingerprint: string | null }>()
  const points = await db.prepare('SELECT status,content_fingerprint,total_points FROM point_rules WHERE point_rule_version=?')
    .bind(row.point_rule_version).first<{ status: string; content_fingerprint: string | null; total_points: number }>()
  const sunk = await db.prepare(`SELECT status,content_fingerprint,trigger_remaining_sec,
    minimum_candidate_investment,requires_key_risk FROM sunk_cost_rules WHERE sunk_cost_rule_version=?`)
    .bind(row.sunk_cost_rule_version).first<{ status: string; content_fingerprint: string | null; trigger_remaining_sec: number; minimum_candidate_investment: number; requires_key_risk: number }>()
  const scoring = await db.prepare('SELECT status FROM scoring_definitions WHERE scoring_version=?')
    .bind(row.scoring_version).first<{ status: string }>()
  const benchmark = await db.prepare('SELECT status,is_provisional FROM benchmark_sets WHERE benchmark_version=?')
    .bind(row.benchmark_version).first<{ status: string; is_provisional: number }>()
  for (const [value, path] of [[material, 'materialVersion'], [points, 'pointRuleVersion'], [sunk, 'sunkCostRuleVersion'], [scoring, 'scoringVersion'], [benchmark, 'benchmarkVersion']] as const) {
    if (!value) add('COMPONENT_NOT_FOUND', path, 'The referenced component does not exist.')
    else if (value.status !== 'published') add('COMPONENT_NOT_PUBLISHED', path, 'The referenced component must be published.')
  }
  if (material) {
    const counts = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM candidate_material_profiles WHERE material_version=?) AS profiles,
      (SELECT COUNT(*) FROM candidate_evidence_items WHERE material_version=?) AS evidence,
      (SELECT COUNT(*) FROM candidate_evidence_items WHERE material_version=? AND is_key_risk=1) AS keyRisks`)
      .bind(row.material_version, row.material_version, row.material_version)
      .first<{ profiles: number; evidence: number; keyRisks: number }>()
    if (counts?.profiles !== 5 || counts.evidence !== 20) add('MATERIAL_STRUCTURE_INVALID', 'materialVersion', 'The material must contain five profiles and twenty evidence items.')
    if (sunk?.requires_key_risk === 1 && counts?.keyRisks === 0) add('KEY_RISK_REQUIRED', 'sunkCostRuleVersion', 'The sunk-cost rule requires key-risk evidence.')
  }
  if (sunk && points && sunk.minimum_candidate_investment > points.total_points) add('SUNK_INVESTMENT_EXCEEDS_POINTS', 'sunkCostRuleVersion', 'Minimum investment exceeds total points.')
  if (sunk && sunk.trigger_remaining_sec >= 900) add('SUNK_TRIGGER_INVALID', 'sunkCostRuleVersion', 'The sunk-cost trigger must occur within task duration.')
  if (benchmark?.is_provisional === 1) warnings.push({ code: 'BENCHMARK_PROVISIONAL', path: 'benchmarkVersion', message: 'The published benchmark is provisional.' })
  if (row.norm_version === null) warnings.push({ code: 'NORMS_UNAVAILABLE', path: 'normVersion', message: 'Norm parameters are not available during prepilot.' })
  const fingerprint = await fingerprintConfiguration({
    taskVersion: row.task_version, materialVersion: row.material_version,
    materialFingerprint: material?.content_fingerprint ?? '',
    pointRuleVersion: row.point_rule_version, pointRuleFingerprint: points?.content_fingerprint ?? '',
    sunkCostRuleVersion: row.sunk_cost_rule_version, sunkCostRuleFingerprint: sunk?.content_fingerprint ?? '',
    scoringVersion: row.scoring_version, benchmarkVersion: row.benchmark_version, normVersion: row.norm_version,
  })
  return { errors, warnings, fingerprint }
}

async function configurationSetRoute(
  request: Request,
  env: Env,
  requestId: string,
  segments: string[],
): Promise<Response> {
  if (request.method === 'GET') {
    await authenticateAdmin(request, env, { requestId })
    if (segments.length === 0) {
      const result = await env.DB.prepare('SELECT * FROM configuration_sets ORDER BY created_at DESC,config_set_id')
        .all<ConfigRow>()
      return adminSuccessResponse({ items: result.results.map(configProjection) }, requestId)
    }
    if (segments.length === 1) {
      const row = await env.DB.prepare('SELECT * FROM configuration_sets WHERE config_set_id=?')
        .bind(segments[0]).first<ConfigRow>()
      if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The configuration set does not exist.')
      return adminSuccessResponse(configProjection(row), requestId)
    }
  }
  const context = await readWriteContext(request, env, requestId)
  if (context.replay) return adminSuccessResponse(context.replay.data, requestId, context.replay.status)
  if (request.method === 'POST' && segments.length === 0) {
    requireFields(context.body, ['configSetId', 'displayName', 'cloneFromConfigSetId'])
    const id = requiredText(context.body.configSetId, 'configSetId')
    const displayName = requiredText(context.body.displayName, 'displayName')
    const source = requiredText(context.body.cloneFromConfigSetId, 'cloneFromConfigSetId')
    if (!isConfigurationVersion(id)) throw new AdminConfigurationError(400, 'CONFIG_VERSION_INVALID', 'The configuration set ID is invalid.')
    const sourceRow = await env.DB.prepare('SELECT * FROM configuration_sets WHERE config_set_id=?')
      .bind(source).first<ConfigRow>()
    if (!sourceRow) throw new AdminConfigurationError(404, 'CONFIG_SOURCE_NOT_FOUND', 'The source configuration set does not exist.')
    if (sourceRow.status !== 'published') throw new AdminConfigurationError(409, 'CONFIG_SOURCE_NOT_PUBLISHED', 'Only published configuration sets can be cloned.')
    const now = new Date().toISOString()
    const data = {
      ...configProjection(sourceRow), configSetId: id, displayName, sourceConfigSetId: source,
      status: 'draft', active: false, revision: 1, validationStatus: 'not_validated',
      validationReport: { errors: [], warnings: [] }, fingerprint: null,
      publishedAt: null, activatedAt: null,
    }
    return commitWrite(env, requestId, context, {
      action: 'configuration_set_created', targetType: 'configuration_set', targetId: id,
      status: 201, data, metadata: { version: id, revision: 1, validationStatus: 'not_validated' },
      statements: [env.DB.prepare(`INSERT INTO configuration_sets (
        config_set_id,task_version,material_version,point_rule_version,scoring_version,
        benchmark_version,norm_version,status,is_active,created_at,published_at,
        sunk_cost_rule_version,display_name,source_config_set_id,revision_no,
        validation_status,validation_report_json,config_fingerprint,
        created_by_admin_user_id,updated_by_admin_user_id,updated_at,validated_at,activated_at
      ) SELECT ?,task_version,material_version,point_rule_version,scoring_version,
        benchmark_version,norm_version,'draft',0,?,NULL,sunk_cost_rule_version,?,?,1,
        'not_validated',json('{"errors":[],"warnings":[]}'),NULL,?,?,?,NULL,NULL
        FROM configuration_sets WHERE config_set_id=?`).bind(
          id, now, displayName, source, context.admin.adminUserId,
          context.admin.adminUserId, now, source,
        )],
    })
  }
  if (request.method === 'PUT' && segments.length === 1) {
    requireFields(context.body, [
      'expectedRevision', 'displayName', 'taskVersion', 'materialVersion',
      'pointRuleVersion', 'sunkCostRuleVersion', 'scoringVersion',
      'benchmarkVersion', 'normVersion',
    ])
    const expectedRevision = requiredRevision(context.body.expectedRevision)
    const displayName = requiredText(context.body.displayName, 'displayName')
    const taskVersion = requiredText(context.body.taskVersion, 'taskVersion')
    const materialVersion = requiredText(context.body.materialVersion, 'materialVersion')
    const pointRuleVersion = requiredText(context.body.pointRuleVersion, 'pointRuleVersion')
    const sunkCostRuleVersion = requiredText(context.body.sunkCostRuleVersion, 'sunkCostRuleVersion')
    const scoringVersion = requiredText(context.body.scoringVersion, 'scoringVersion')
    const benchmarkVersion = requiredText(context.body.benchmarkVersion, 'benchmarkVersion')
    if (context.body.normVersion !== null) throw new AdminConfigurationError(400, 'NORM_VERSION_UNSUPPORTED', 'normVersion must remain null during Stage 10A.')
    const row = await env.DB.prepare('SELECT * FROM configuration_sets WHERE config_set_id=?')
      .bind(segments[0]).first<ConfigRow>()
    if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The configuration set does not exist.')
    if (row.status !== 'draft') throw new AdminConfigurationError(409, 'CONFIG_VERSION_IMMUTABLE', 'Published configuration sets cannot be changed.')
    if (row.revision_no !== expectedRevision) throw new AdminConfigurationError(409, 'CONFIG_REVISION_CONFLICT', 'The configuration draft was changed in another editor.')
    const revision = expectedRevision + 1
    const now = new Date().toISOString()
    const data = {
      configSetId: segments[0], displayName, taskVersion, materialVersion,
      pointRuleVersion, sunkCostRuleVersion, scoringVersion, benchmarkVersion,
      normVersion: null, status: 'draft', active: false, revision,
      validationStatus: 'stale', fingerprint: null,
    }
    return commitWrite(env, requestId, context, {
      action: 'configuration_set_updated', targetType: 'configuration_set', targetId: segments[0], data,
      metadata: { version: segments[0], revision, validationStatus: 'stale' },
      statements: [env.DB.prepare(`UPDATE configuration_sets SET display_name=?,task_version=?,
        material_version=?,point_rule_version=?,sunk_cost_rule_version=?,scoring_version=?,
        benchmark_version=?,norm_version=NULL,revision_no=?,validation_status='stale',
        config_fingerprint=NULL,updated_by_admin_user_id=?,updated_at=?,validated_at=NULL
        WHERE config_set_id=? AND status='draft' AND revision_no=?`).bind(
          displayName, taskVersion, materialVersion, pointRuleVersion, sunkCostRuleVersion,
          scoringVersion, benchmarkVersion, revision, context.admin.adminUserId,
          now, segments[0], expectedRevision,
        )],
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'validate') {
    requireFields(context.body, [])
    const row = await env.DB.prepare('SELECT * FROM configuration_sets WHERE config_set_id=?')
      .bind(segments[0]).first<ConfigRow>()
    if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The configuration set does not exist.')
    if (row.status !== 'draft') throw new AdminConfigurationError(409, 'CONFIG_VERSION_IMMUTABLE', 'Published configuration sets cannot be revalidated.')
    const { errors, warnings, fingerprint } = await validateConfigurationSet(env.DB, row)
    const validationStatus = errors.length ? 'invalid' : 'valid'
    const now = new Date().toISOString()
    const data = { configSetId: segments[0], revision: row.revision_no, validationStatus, errors, warnings, fingerprint }
    return commitWrite(env, requestId, context, {
      action: 'configuration_set_validated', targetType: 'configuration_set', targetId: segments[0], data,
      metadata: { version: segments[0], revision: row.revision_no, validationStatus,
        contentFingerprint: fingerprint, warningCount: warnings.length, errorCount: errors.length },
      statements: [
        env.DB.prepare(`INSERT INTO configuration_validation_runs (
          validation_run_id,target_type,target_version,target_revision,validation_status,
          errors_json,warnings_json,content_fingerprint,admin_user_id,request_id,created_at
        ) VALUES (?,'configuration_set',?,?,?,json(?),json(?),?,?,?,?)`).bind(
          crypto.randomUUID(), segments[0], row.revision_no, validationStatus,
          JSON.stringify(errors), JSON.stringify(warnings), fingerprint,
          context.admin.adminUserId, requestId, now,
        ),
        env.DB.prepare(`UPDATE configuration_sets SET validation_status=?,validation_report_json=json(?),
          config_fingerprint=?,validated_at=?,updated_at=?,updated_by_admin_user_id=?
          WHERE config_set_id=?`).bind(validationStatus, JSON.stringify({ errors, warnings }),
          fingerprint, now, now, context.admin.adminUserId, segments[0]),
      ],
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'publish') {
    requireFields(context.body, [])
    const row = await env.DB.prepare('SELECT * FROM configuration_sets WHERE config_set_id=?')
      .bind(segments[0]).first<ConfigRow>()
    if (!row) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The configuration set does not exist.')
    if (row.status === 'published') {
      return commitWrite(env, requestId, context, {
        action: 'configuration_set_published', targetType: 'configuration_set', targetId: segments[0], data: configProjection(row), statements: [],
      })
    }
    if (row.status !== 'draft' || row.validation_status !== 'valid' || !row.config_fingerprint) {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_REQUIRED', 'The current configuration draft must pass validation before publication.')
    }
    const current = await validateConfigurationSet(env.DB, row)
    if (current.errors.length || current.fingerprint !== row.config_fingerprint) {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_STALE', 'Referenced components changed after validation.')
    }
    const latest = await env.DB.prepare(`SELECT target_revision,content_fingerprint,validation_status
      FROM configuration_validation_runs WHERE target_type='configuration_set' AND target_version=?
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(segments[0])
      .first<{ target_revision: number; content_fingerprint: string; validation_status: string }>()
    if (!latest || latest.target_revision !== row.revision_no || latest.content_fingerprint !== row.config_fingerprint || latest.validation_status !== 'valid') {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_STALE', 'The latest validation no longer matches this configuration draft.')
    }
    const now = new Date().toISOString()
    const data = { ...configProjection(row), status: 'published', publishedAt: now }
    return commitWrite(env, requestId, context, {
      action: 'configuration_set_published', targetType: 'configuration_set', targetId: segments[0], data,
      metadata: { version: segments[0], revision: row.revision_no, validationStatus: 'valid', contentFingerprint: row.config_fingerprint,
        warningCount: current.warnings.length, errorCount: 0 },
      statements: [env.DB.prepare(`UPDATE configuration_sets SET status='published',published_by_admin_user_id=?,
        published_at=?,updated_at=? WHERE config_set_id=? AND status='draft'`)
        .bind(context.admin.adminUserId, now, now, segments[0])],
    })
  }
  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'activate') {
    requireFields(context.body, ['confirmConfigSetId'])
    if (context.body.confirmConfigSetId !== segments[0]) {
      throw new AdminConfigurationError(400, 'ACTIVATION_CONFIRMATION_INVALID', 'The typed configuration ID does not match.')
    }
    const target = await env.DB.prepare('SELECT * FROM configuration_sets WHERE config_set_id=?')
      .bind(segments[0]).first<ConfigRow>()
    if (!target) throw new AdminConfigurationError(404, 'CONFIG_VERSION_NOT_FOUND', 'The configuration set does not exist.')
    if (target.status !== 'published' || target.validation_status !== 'valid' || !target.config_fingerprint) {
      throw new AdminConfigurationError(409, 'CONFIG_NOT_ACTIVATABLE', 'Only a valid published configuration can be activated.')
    }
    const currentValidation = await validateConfigurationSet(env.DB, target)
    if (currentValidation.errors.length || currentValidation.fingerprint !== target.config_fingerprint) {
      throw new AdminConfigurationError(409, 'CONFIG_VALIDATION_STALE', 'Referenced components changed after validation.')
    }
    const previous = await env.DB.prepare('SELECT config_set_id FROM configuration_sets WHERE is_active=1')
      .first<{ config_set_id: string }>()
    const previousId = previous?.config_set_id ?? null
    const now = new Date().toISOString()
    const rollback = previousId !== null && target.activated_at !== null
    const action: AdminAuditAction = rollback
      ? 'configuration_set_rollback_activated' : 'configuration_set_activated'
    const data = { configSetId: segments[0], previousActiveConfigSetId: previousId, active: true, activatedAt: now, alreadyActive: previousId === segments[0] }
    if (previousId === segments[0]) {
      return commitWrite(env, requestId, context, { action, targetType: 'configuration_set', targetId: segments[0], data, statements: [] })
    }
    return commitWrite(env, requestId, context, {
      action, targetType: 'configuration_set', targetId: segments[0], data,
      metadata: { version: segments[0], previousActiveConfig: previousId, newActiveConfig: segments[0], contentFingerprint: target.config_fingerprint },
      statements: [
        env.DB.prepare('UPDATE configuration_sets SET is_active=0 WHERE is_active=1'),
        env.DB.prepare(`UPDATE configuration_sets SET is_active=1,activated_by_admin_user_id=?,
          activated_at=? WHERE config_set_id=? AND status='published' AND validation_status='valid'`)
          .bind(context.admin.adminUserId, now, segments[0]),
        env.DB.prepare(`INSERT INTO configuration_activation_history (
          activation_id,config_set_id,previous_active_config_set_id,admin_user_id,request_id,activated_at
        ) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), segments[0], previousId,
          context.admin.adminUserId, requestId, now),
      ],
    })
  }
  throw new AdminConfigurationError(404, 'NOT_FOUND', 'The requested configuration endpoint does not exist.')
}

export async function handleAdminConfiguration(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname
    const prefix = '/api/admin/config/'
    if (!path.startsWith(prefix)) throw new AdminConfigurationError(404, 'NOT_FOUND', 'The requested configuration endpoint does not exist.')
    const [resource, ...segments] = path.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent)
    if (resource === 'material-sets') return await materialRoute(request, env, requestId, segments)
    if (resource === 'point-rules') return await ruleRoute('point', request, env, requestId, segments)
    if (resource === 'sunk-cost-rules') return await ruleRoute('sunk', request, env, requestId, segments)
    if (resource === 'configuration-sets') return await configurationSetRoute(request, env, requestId, segments)
    throw new AdminConfigurationError(404, 'NOT_FOUND', 'The requested configuration endpoint does not exist.')
  } catch (error) {
    if (error instanceof AdminAuthError || error instanceof AdminCsrfError || error instanceof AdminConfigurationError) {
      return adminErrorResponse(error.status, { code: error.code, message: error.message }, requestId)
    }
    return adminErrorResponse(500, {
      code: 'ADMIN_CONFIGURATION_FAILED',
      message: 'The administrator configuration request could not be completed.',
    }, requestId)
  }
}
