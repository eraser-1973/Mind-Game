import { hashSessionToken } from '../domain/sessionToken'

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i

export class SessionAuthError extends Error {
  constructor(
    readonly status: 401 | 409,
    readonly code:
      | 'SESSION_UNAUTHORIZED'
      | 'SESSION_REVOKED'
      | 'SESSION_NOT_ACTIVE',
    message: string,
  ) {
    super(message)
    this.name = 'SessionAuthError'
  }
}

export type AuthenticatedSession = {
  sessionId: string
  participantId: string
  mode: 'formal'
  completionStatus: string
  currentStep: string
  configSetId: string
  taskVersion: string
  materialVersion: string
  pointRuleVersion: string
  sunkCostRuleVersion: string
  scoringVersion: string
  benchmarkVersion: string
  normVersion: string | null
  candidateDisplayOrder: string
  initialOpenedCandidate: string
  createdAt: string
  startedAt: string | null
  deadlineAt: string | null
}

type AuthRow = {
  session_id: string
  participant_id: string
  mode: string
  completion_status: string
  current_step: string
  config_set_id: string
  task_version: string
  material_version: string
  point_rule_version: string
  sunk_cost_rule_version: string
  scoring_version: string
  benchmark_version: string
  norm_version: string | null
  candidate_display_order: string
  initial_opened_candidate: string
  created_at: string
  started_at: string | null
  deadline_at: string | null
  token_hash: string
  revoked_at: string | null
}

function parseCookie(header: string | null): string | null {
  if (!header) return null
  for (const entry of header.split(';')) {
    const [name, ...parts] = entry.trim().split('=')
    if (name === 'mg_session') return parts.join('=')
  }
  return null
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function unauthorized(): SessionAuthError {
  return new SessionAuthError(
    401,
    'SESSION_UNAUTHORIZED',
    'The formal session could not be authenticated.',
  )
}

export async function authenticateFormalSession(
  request: Request,
  db: D1Database,
  expectedSessionId?: string,
  options: { allowedCompletionStatuses?: readonly string[] } = {},
): Promise<AuthenticatedSession> {
  const token = parseCookie(request.headers.get('Cookie'))
  if (!token || !TOKEN_PATTERN.test(token)) throw unauthorized()

  const suppliedHash = await hashSessionToken(token)
  const row = await db.prepare(
    `SELECT s.session_id, s.participant_id, s.mode, s.completion_status,
            s.current_step, s.config_set_id, s.task_version,
            s.material_version, s.point_rule_version, s.sunk_cost_rule_version, s.scoring_version,
            s.benchmark_version, s.norm_version, s.candidate_display_order,
            s.initial_opened_candidate, s.created_at, s.started_at,
            s.deadline_at, c.token_hash, c.revoked_at
     FROM session_credentials c
     JOIN sessions s ON s.session_id = c.session_id
     WHERE c.token_hash = ?`,
  ).bind(suppliedHash).first<AuthRow>()

  if (
    !row ||
    row.mode !== 'formal' ||
    !constantTimeEqual(row.token_hash, suppliedHash) ||
    (expectedSessionId !== undefined && row.session_id !== expectedSessionId)
  ) {
    throw unauthorized()
  }

  if (row.revoked_at !== null) {
    throw new SessionAuthError(
      401,
      'SESSION_REVOKED',
      'The formal session credential has been revoked.',
    )
  }

  const allowedStatuses = options.allowedCompletionStatuses ?? ['in_progress']
  if (!allowedStatuses.includes(row.completion_status)) {
    throw new SessionAuthError(
      409,
      'SESSION_NOT_ACTIVE',
      'The formal session is no longer active.',
    )
  }

  return {
    sessionId: row.session_id,
    participantId: row.participant_id,
    mode: 'formal',
    completionStatus: row.completion_status,
    currentStep: row.current_step,
    configSetId: row.config_set_id,
    taskVersion: row.task_version,
    materialVersion: row.material_version,
    pointRuleVersion: row.point_rule_version,
    sunkCostRuleVersion: row.sunk_cost_rule_version,
    scoringVersion: row.scoring_version,
    benchmarkVersion: row.benchmark_version,
    normVersion: row.norm_version,
    candidateDisplayOrder: row.candidate_display_order,
    initialOpenedCandidate: row.initial_opened_candidate,
    createdAt: row.created_at,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
  }
}
