import {
  isCandidateDisplayOrder,
  type CandidateDisplayOrder,
} from '../domain/candidateOrder'
import type { ConfigurationSet } from './configurationSets'
import type { DuplicateIdentitySummary } from './participants'

export type SessionRow = {
  session_id: string
  participant_id: string
  creation_key: string
  mode: 'formal'
  config_set_id: string
  task_version: string
  material_version: string
  point_rule_version: string
  scoring_version: string
  benchmark_version: string
  norm_version: string | null
  candidate_display_order: string
  initial_opened_candidate: string
  current_step: string
  created_at: string
}

export async function findSessionByCreationKey(
  db: D1Database,
  creationKey: string,
): Promise<SessionRow | null> {
  return db.prepare(
    `SELECT session_id, participant_id, creation_key, mode, config_set_id,
            task_version, material_version, point_rule_version,
            scoring_version, benchmark_version, norm_version,
            candidate_display_order, initial_opened_candidate,
            current_step, created_at
     FROM sessions WHERE creation_key = ?`,
  ).bind(creationKey).first<SessionRow>()
}

export function buildSessionInsertStatements(
  db: D1Database,
  input: {
    sessionId: string
    participantId: string
    creationKey: string
    config: ConfigurationSet
    candidateDisplayOrder: CandidateDisplayOrder
    clientVersion: string | null
    duplicates: DuplicateIdentitySummary
    tokenHash: string
    createdAt: string
  },
): D1PreparedStatement[] {
  return [
    db.prepare(
      `INSERT INTO sessions (
        session_id, participant_id, creation_key, mode, config_set_id,
        task_version, material_version, point_rule_version, scoring_version,
        benchmark_version, norm_version, candidate_display_order,
        initial_opened_candidate, completion_status, current_step,
        final_submit_mode, client_version, duplicate_student_id,
        duplicate_phone, prior_identity_match_count, error_count,
        created_at, started_at, deadline_at, ended_at
      ) VALUES (
        ?, ?, ?, 'formal', ?, ?, ?, ?, ?, ?, ?, json(?), ?,
        'in_progress', 'demographics', 'none', ?, ?, ?, ?, 0,
        ?, NULL, NULL, NULL
      )`,
    ).bind(
      input.sessionId,
      input.participantId,
      input.creationKey,
      input.config.configSetId,
      input.config.taskVersion,
      input.config.materialVersion,
      input.config.pointRuleVersion,
      input.config.scoringVersion,
      input.config.benchmarkVersion,
      input.config.normVersion,
      JSON.stringify(input.candidateDisplayOrder),
      input.candidateDisplayOrder[0],
      input.clientVersion,
      input.duplicates.duplicateStudentId,
      input.duplicates.duplicatePhone,
      input.duplicates.priorIdentityMatchCount,
      input.createdAt,
    ),
    db.prepare(
      `INSERT INTO session_credentials (
        session_id, token_hash, created_at, rotated_at, revoked_at
      ) VALUES (?, ?, ?, ?, NULL)`,
    ).bind(
      input.sessionId,
      input.tokenHash,
      input.createdAt,
      input.createdAt,
    ),
  ]
}

export async function rotateSessionCredential(
  db: D1Database,
  sessionId: string,
  tokenHash: string,
  rotatedAt: string,
): Promise<void> {
  const result = await db.prepare(
    `UPDATE session_credentials
     SET token_hash = ?, rotated_at = ?, revoked_at = NULL
     WHERE session_id = ?`,
  ).bind(tokenHash, rotatedAt, sessionId).run()

  if (result.meta.changes !== 1) {
    throw new Error('Credential rotation failed')
  }
}

export type SafeSessionData = {
  participantId: string
  sessionId: string
  mode: 'formal'
  configSetId: string
  versions: {
    task: string
    material: string
    pointRule: string
    scoring: string
    benchmark: string
    norm: string | null
  }
  candidateDisplayOrder: CandidateDisplayOrder
  initialOpenedCandidate: string
  currentStep: string
  createdAt: string
}

export function projectSafeSession(row: SessionRow): SafeSessionData {
  let candidateDisplayOrder: unknown
  try {
    candidateDisplayOrder = JSON.parse(row.candidate_display_order)
  } catch {
    throw new Error('Stored candidate order is invalid')
  }

  if (!isCandidateDisplayOrder(candidateDisplayOrder)) {
    throw new Error('Stored candidate order is invalid')
  }

  return {
    participantId: row.participant_id,
    sessionId: row.session_id,
    mode: 'formal',
    configSetId: row.config_set_id,
    versions: {
      task: row.task_version,
      material: row.material_version,
      pointRule: row.point_rule_version,
      scoring: row.scoring_version,
      benchmark: row.benchmark_version,
      norm: row.norm_version,
    },
    candidateDisplayOrder,
    initialOpenedCandidate: row.initial_opened_candidate,
    currentStep: row.current_step,
    createdAt: row.created_at,
  }
}
