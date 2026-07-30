export type SessionStatus = 'in_progress' | 'completed' | 'abandoned' | 'technical_error'

export type SessionRow = {
  sessionId: string
  participantId: string
  mode: 'formal'
  status: SessionStatus
  schemaVersion: string
  appVersion: string
  startedAt: string
  updatedAt: string
  lastHeartbeatAt: string | null
  completedAt: string | null
  submissionType: string | null
  finalCandidateId: string | null
  finalConfidence: number | null
  invalidForAssessment: number
  invalidReason: string | null
  recoveryTokenHash: string
  finalPayloadJson: string | null
}

export type EventRow = {
  eventId: string
  sessionId: string
  eventType: string
  candidateId: string | null
  stage: string | null
  occurredAt: string
  elapsedSec: number | null
  payloadJson: string
  createdAt: string
}

export type SnapshotRow = {
  snapshotId: string
  sessionId: string
  stage: 'T1' | 'T2' | 'T3' | 'FINAL'
  preferredCandidateId: string
  confidence: number
  submittedAt: string
  payloadJson: string | null
}

export type ClientErrorRow = {
  errorId: string
  sessionId: string | null
  errorType: string
  message: string
  stack: string | null
  route: string | null
  occurredAt: string
  appVersion: string
  fatal: number
  affectedAssessment: number
  payloadJson: string | null
}

export interface FormalSessionRepository {
  createSession(row: SessionRow): Promise<void>
  getSession(sessionId: string): Promise<SessionRow | null>
  updateSession(sessionId: string, patch: Partial<SessionRow>): Promise<void>
  hasEvent(eventId: string): Promise<boolean>
  insertEvents(rows: EventRow[]): Promise<void>
  insertSnapshots(rows: SnapshotRow[]): Promise<void>
  insertClientError(row: ClientErrorRow): Promise<void>
}

type D1Result<T = unknown> = { success: boolean; results?: T[] }
type D1Statement = {
  bind(...values: unknown[]): D1Statement
  first<T = unknown>(): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
}
export type D1DatabaseLike = {
  prepare(sql: string): D1Statement
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>
}

const SESSION_COLUMNS: Array<keyof SessionRow> = [
  'participantId', 'mode', 'status', 'schemaVersion', 'appVersion', 'startedAt',
  'updatedAt', 'lastHeartbeatAt', 'completedAt', 'submissionType',
  'finalCandidateId', 'finalConfidence', 'invalidForAssessment', 'invalidReason',
  'recoveryTokenHash', 'finalPayloadJson',
]
const SESSION_DB_COLUMNS = [
  'participant_id', 'mode', 'status', 'schema_version', 'app_version', 'started_at',
  'updated_at', 'last_heartbeat_at', 'completed_at', 'submission_type',
  'final_candidate_id', 'final_confidence', 'invalid_for_assessment', 'invalid_reason',
  'recovery_token_hash', 'final_payload_json',
]

const mapSession = (row: Record<string, unknown>): SessionRow => ({
  sessionId: String(row.session_id), participantId: String(row.participant_id), mode: 'formal',
  status: row.status as SessionStatus, schemaVersion: String(row.schema_version),
  appVersion: String(row.app_version), startedAt: String(row.started_at), updatedAt: String(row.updated_at),
  lastHeartbeatAt: row.last_heartbeat_at as string | null, completedAt: row.completed_at as string | null,
  submissionType: row.submission_type as string | null, finalCandidateId: row.final_candidate_id as string | null,
  finalConfidence: row.final_confidence as number | null, invalidForAssessment: Number(row.invalid_for_assessment),
  invalidReason: row.invalid_reason as string | null, recoveryTokenHash: String(row.recovery_token_hash),
  finalPayloadJson: row.final_payload_json as string | null,
})

export function createD1Repository(db: D1DatabaseLike): FormalSessionRepository {
  return {
    async createSession(row) {
      await db.prepare(`INSERT INTO sessions (session_id, ${SESSION_DB_COLUMNS.join(', ')}) VALUES (${Array(SESSION_DB_COLUMNS.length + 1).fill('?').join(', ')})`)
        .bind(row.sessionId, ...SESSION_COLUMNS.map((key) => row[key])).run()
    },
    async getSession(sessionId) {
      const row = await db.prepare('SELECT * FROM sessions WHERE session_id = ?').bind(sessionId).first<Record<string, unknown>>()
      return row ? mapSession(row) : null
    },
    async updateSession(sessionId, patch) {
      const entries = SESSION_COLUMNS.filter((key) => patch[key] !== undefined)
      if (!entries.length) return
      const columns = entries.map((key) => SESSION_DB_COLUMNS[SESSION_COLUMNS.indexOf(key)])
      await db.prepare(`UPDATE sessions SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE session_id = ?`)
        .bind(...entries.map((key) => patch[key]), sessionId).run()
    },
    async hasEvent(eventId) {
      return Boolean(await db.prepare('SELECT event_id FROM events WHERE event_id = ?').bind(eventId).first())
    },
    async insertEvents(rows) {
      if (!rows.length) return
      await db.batch(rows.map((row) => db.prepare('INSERT OR IGNORE INTO events (event_id, session_id, event_type, candidate_id, stage, occurred_at, elapsed_sec, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(row.eventId, row.sessionId, row.eventType, row.candidateId, row.stage, row.occurredAt, row.elapsedSec, row.payloadJson, row.createdAt)))
    },
    async insertSnapshots(rows) {
      if (!rows.length) return
      await db.batch(rows.map((row) => db.prepare('INSERT OR REPLACE INTO stage_snapshots (snapshot_id, session_id, stage, preferred_candidate_id, confidence, submitted_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(row.snapshotId, row.sessionId, row.stage, row.preferredCandidateId, row.confidence, row.submittedAt, row.payloadJson)))
    },
    async insertClientError(row) {
      await db.prepare('INSERT OR IGNORE INTO client_errors (error_id, session_id, error_type, message, stack, route, occurred_at, app_version, fatal, affected_assessment, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(row.errorId, row.sessionId, row.errorType, row.message, row.stack, row.route, row.occurredAt, row.appVersion, row.fatal, row.affectedAssessment, row.payloadJson).run()
    },
  }
}
