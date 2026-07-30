import { createD1Repository, type FormalSessionRepository, type SessionRow } from './repository'

type Env = { DB: Parameters<typeof createD1Repository>[0]; ASSETS: { fetch(request: Request): Promise<Response> } }
type ApiError = { status: number; code: string; message: string }
const SESSION_ID = /^sess-[a-zA-Z0-9-]{8,128}$/
const PARTICIPANT_ID = /^MG-[A-Z0-9-]{4,128}$/
const EVENT_ID = /^[a-zA-Z0-9_-]{6,128}$/
const IDENTIFIABLE_KEYS = /^(name|fullName|phone|mobile|email|studentId|schoolId|ip|ipAddress)$/i
const ABANDON_AFTER_MS = 30 * 60 * 1000

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
})
const ok = (data: unknown = {}) => response(200, { ok: true, data })
const fail = ({ status, code, message }: ApiError) => response(status, { ok: false, error: { code, message } })
const apiError = (status: number, code: string, message: string): ApiError => ({ status, code, message })
const isInteger = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max

const containsIdentifiableField = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsIdentifiableField)
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => IDENTIFIABLE_KEYS.test(key) || containsIdentifiableField(child))
}
const parseBody = async (request: Request) => {
  try { return await request.json() as Record<string, unknown> } catch { throw apiError(400, 'INVALID_JSON', '请求体必须是有效JSON。') }
}
const hashToken = async (token: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const authorize = async (request: Request, repository: FormalSessionRepository, sessionId: string) => {
  if (!SESSION_ID.test(sessionId)) throw apiError(400, 'INVALID_SESSION_ID', '会话编号格式无效。')
  const session = await repository.getSession(sessionId)
  if (!session) throw apiError(404, 'SESSION_NOT_FOUND', '会话不存在。')
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || await hashToken(token) !== session.recoveryTokenHash) throw apiError(401, 'INVALID_RECOVERY_TOKEN', '恢复令牌无效。')
  return session
}
const validateAnonymous = (body: unknown) => {
  if (containsIdentifiableField(body)) throw apiError(400, 'IDENTIFIABLE_DATA_REJECTED', '研究数据不得包含直接身份字段。')
}
const validateEvent = (value: unknown) => {
  const event = value as Record<string, unknown>
  if (!event || !EVENT_ID.test(String(event.eventId ?? '')) || typeof event.eventType !== 'string' || typeof event.occurredAt !== 'string') throw apiError(400, 'INVALID_EVENT', '事件字段无效。')
  const payload = (event.payload ?? {}) as Record<string, unknown>
  if ('score' in payload && !isInteger(payload.score, 0, 100)) throw apiError(400, 'INVALID_SCORE', '评分必须为0到100整数。')
  if (event.eventType === 'verify') {
    if (!isInteger(payload.pointsBefore, 0) || !isInteger(payload.pointsCost, 0) || !isInteger(payload.pointsAfter, 0) || Number(payload.pointsAfter) !== Number(payload.pointsBefore) - Number(payload.pointsCost)) throw apiError(400, 'INVALID_POINTS', '查证点数关系无效。')
    if (!Array.isArray(payload.evidenceId) || payload.evidenceId.some((id) => typeof id !== 'string')) throw apiError(400, 'INVALID_EVIDENCE_IDS', '证据编号必须是字符串数组。')
  }
  validateAnonymous(event)
  return event
}

export function createApiHandler(repository: FormalSessionRepository) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await parseBody(request); validateAnonymous(body)
        if (body.mode !== 'formal') throw apiError(400, 'FORMAL_MODE_REQUIRED', '该接口只接受正式模式。')
        if (!PARTICIPANT_ID.test(String(body.participantId ?? ''))) throw apiError(400, 'INVALID_PARTICIPANT_ID', '匿名参与者编号格式无效。')
        const now = new Date().toISOString(); const sessionId = `sess-${crypto.randomUUID()}`; const recoveryToken = crypto.randomUUID()
        const row: SessionRow = {
          sessionId, participantId: String(body.participantId), mode: 'formal', status: 'in_progress',
          schemaVersion: String(body.schemaVersion ?? ''), appVersion: String(body.appVersion ?? ''),
          startedAt: now, updatedAt: now, lastHeartbeatAt: now, completedAt: null,
          submissionType: null, finalCandidateId: null, finalConfidence: null,
          invalidForAssessment: 0, invalidReason: null, recoveryTokenHash: await hashToken(recoveryToken), finalPayloadJson: null,
        }
        await repository.createSession(row)
        return ok({ sessionId, recoveryToken, participantId: row.participantId, status: row.status, serverTime: now })
      }

      if (request.method === 'POST' && url.pathname === '/api/client-errors') {
        const body = await parseBody(request); validateAnonymous(body)
        if (!EVENT_ID.test(String(body.errorId ?? '')) || typeof body.message !== 'string' || typeof body.errorType !== 'string') throw apiError(400, 'INVALID_CLIENT_ERROR', '错误记录字段无效。')
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
        if (sessionId) await authorize(request, repository, sessionId)
        await repository.insertClientError({ errorId: String(body.errorId), sessionId, errorType: String(body.errorType), message: String(body.message).slice(0, 2000), stack: typeof body.stack === 'string' ? body.stack.slice(0, 8000) : null, route: typeof body.route === 'string' ? body.route : null, occurredAt: String(body.occurredAt ?? new Date().toISOString()), appVersion: String(body.appVersion ?? ''), fatal: body.fatal ? 1 : 0, affectedAssessment: body.affectedAssessment ? 1 : 0, payloadJson: JSON.stringify(body.payload ?? null) })
        if (sessionId && body.fatal) await repository.updateSession(sessionId, { status: 'technical_error', invalidForAssessment: 1, invalidReason: String(body.message).slice(0, 500), updatedAt: new Date().toISOString() })
        return ok({ accepted: true })
      }

      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(resume|events|snapshots|heartbeat|complete|abandon)$/)
      if (!match) throw apiError(404, 'NOT_FOUND', '接口不存在。')
      const [, sessionId, operation] = match
      const session = await authorize(request, repository, sessionId)
      if (operation === 'resume' && request.method === 'GET') {
        if (session.status === 'in_progress' && session.lastHeartbeatAt && Date.now() - Date.parse(session.lastHeartbeatAt) > ABANDON_AFTER_MS) {
          await repository.updateSession(sessionId, { status: 'abandoned', updatedAt: new Date().toISOString() })
          session.status = 'abandoned'
        }
        return ok({ sessionId, participantId: session.participantId, status: session.status, finalCandidateId: session.finalCandidateId, finalConfidence: session.finalConfidence, finalPayload: session.finalPayloadJson ? JSON.parse(session.finalPayloadJson) : null, serverTime: new Date().toISOString() })
      }
      if (operation === 'events' && request.method === 'POST') {
        const body = await parseBody(request); const events = Array.isArray(body.events) ? body.events.map(validateEvent) : []
        const unseen = []
        for (const event of events) if (!await repository.hasEvent(String(event.eventId))) unseen.push(event)
        if (unseen.length && session.status !== 'in_progress') throw apiError(409, 'SESSION_NOT_WRITABLE', '会话已结束，不能写入新事件。')
        const now = new Date().toISOString()
        await repository.insertEvents(unseen.map((event) => ({ eventId: String(event.eventId), sessionId, eventType: String(event.eventType), candidateId: typeof event.candidateId === 'string' ? event.candidateId : null, stage: typeof event.stage === 'string' ? event.stage : null, occurredAt: String(event.occurredAt), elapsedSec: isInteger(event.elapsedSec, 0) ? Number(event.elapsedSec) : null, payloadJson: JSON.stringify(event.payload ?? {}), createdAt: now })))
        await repository.updateSession(sessionId, { updatedAt: now })
        return ok({ accepted: events.length, inserted: unseen.length })
      }
      if (operation === 'snapshots' && request.method === 'POST') {
        if (session.status !== 'in_progress') throw apiError(409, 'SESSION_NOT_WRITABLE', '会话已结束。')
        const body = await parseBody(request); validateAnonymous(body); const snapshots = Array.isArray(body.snapshots) ? body.snapshots as Record<string, unknown>[] : []
        for (const item of snapshots) if (!EVENT_ID.test(String(item.snapshotId ?? '')) || !['T1', 'T2', 'T3', 'FINAL'].includes(String(item.stage)) || typeof item.preferredCandidateId !== 'string' || !isInteger(item.confidence, 0, 100)) throw apiError(400, 'INVALID_SNAPSHOT', '阶段快照字段无效。')
        await repository.insertSnapshots(snapshots.map((item) => ({ snapshotId: String(item.snapshotId), sessionId, stage: item.stage as 'T1' | 'T2' | 'T3' | 'FINAL', preferredCandidateId: String(item.preferredCandidateId), confidence: Number(item.confidence), submittedAt: String(item.submittedAt), payloadJson: JSON.stringify(item.payload ?? null) })))
        return ok({ accepted: snapshots.length })
      }
      if (operation === 'heartbeat' && request.method === 'PATCH') {
        if (session.status !== 'in_progress') throw apiError(409, 'SESSION_NOT_WRITABLE', '会话已结束。')
        const body = await parseBody(request); validateAnonymous(body); const now = new Date().toISOString()
        await repository.updateSession(sessionId, { lastHeartbeatAt: now, updatedAt: now, finalPayloadJson: JSON.stringify({ heartbeat: body }) })
        return ok({ lastHeartbeatAt: now })
      }
      if (operation === 'complete' && request.method === 'POST') {
        if (session.status === 'completed') throw apiError(409, 'SESSION_ALREADY_COMPLETED', '会话已经完成。')
        if (session.status !== 'in_progress') throw apiError(409, 'SESSION_NOT_WRITABLE', '会话不能完成。')
        const body = await parseBody(request); validateAnonymous(body)
        if (typeof body.finalCandidateId !== 'string' || !isInteger(body.finalConfidence, 0, 100) || !['manual', 'timeout_confirmed', 'timeout_auto'].includes(String(body.submissionType))) throw apiError(400, 'INVALID_FINAL_DECISION', '最终决策字段无效。')
        const now = new Date().toISOString(); await repository.updateSession(sessionId, { status: 'completed', completedAt: now, updatedAt: now, submissionType: String(body.submissionType), finalCandidateId: String(body.finalCandidateId), finalConfidence: Number(body.finalConfidence), finalPayloadJson: JSON.stringify(body.finalPayload ?? null) })
        return ok({ status: 'completed', completedAt: now })
      }
      if (operation === 'abandon' && request.method === 'POST') {
        if (session.status === 'in_progress') await repository.updateSession(sessionId, { status: 'abandoned', updatedAt: new Date().toISOString() })
        return ok({ status: session.status === 'in_progress' ? 'abandoned' : session.status })
      }
      throw apiError(405, 'METHOD_NOT_ALLOWED', '请求方法不受支持。')
    } catch (error) {
      const known = error as Partial<ApiError>
      return fail(known.status && known.code && known.message ? known as ApiError : apiError(500, 'INTERNAL_ERROR', '服务器暂时无法处理请求。'))
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) return createApiHandler(createD1Repository(env.DB))(request)
    return env.ASSETS.fetch(request)
  },
}
