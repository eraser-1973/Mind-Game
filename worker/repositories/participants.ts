import type { NormalizedIdentity } from '../domain/identity'

export type DuplicateIdentitySummary = {
  duplicateStudentId: 0 | 1
  duplicatePhone: 0 | 1
  priorIdentityMatchCount: number
}

type DuplicateIdentityRow = {
  duplicate_student_id: number
  duplicate_phone: number
  prior_identity_match_count: number
}

export async function findDuplicateIdentitySummary(
  db: D1Database,
  identity: NormalizedIdentity,
): Promise<DuplicateIdentitySummary> {
  if (!identity.studentIdNormalized && !identity.phoneNormalized) {
    return {
      duplicateStudentId: 0,
      duplicatePhone: 0,
      priorIdentityMatchCount: 0,
    }
  }

  const row = await db.prepare(
    `SELECT
       MAX(CASE
         WHEN ?1 IS NOT NULL AND student_id_normalized = ?1 THEN 1 ELSE 0
       END) AS duplicate_student_id,
       MAX(CASE
         WHEN ?2 IS NOT NULL AND phone_normalized = ?2 THEN 1 ELSE 0
       END) AS duplicate_phone,
       COUNT(DISTINCT CASE
         WHEN (?1 IS NOT NULL AND student_id_normalized = ?1)
           OR (?2 IS NOT NULL AND phone_normalized = ?2)
         THEN participant_id
       END) AS prior_identity_match_count
     FROM participant_identity`,
  ).bind(
    identity.studentIdNormalized,
    identity.phoneNormalized,
  ).first<DuplicateIdentityRow>()

  return {
    duplicateStudentId: row?.duplicate_student_id ? 1 : 0,
    duplicatePhone: row?.duplicate_phone ? 1 : 0,
    priorIdentityMatchCount: row?.prior_identity_match_count ?? 0,
  }
}

export function buildParticipantInsertStatements(
  db: D1Database,
  input: {
    participantId: string
    identity: NormalizedIdentity
    createdAt: string
  },
): D1PreparedStatement[] {
  return [
    db.prepare(
      'INSERT INTO participants (participant_id, created_at) VALUES (?, ?)',
    ).bind(input.participantId, input.createdAt),
    db.prepare(
      `INSERT INTO participant_identity (
        participant_id, full_name, student_id, student_id_normalized,
        phone, phone_normalized, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.participantId,
      input.identity.fullName,
      input.identity.studentId,
      input.identity.studentIdNormalized,
      input.identity.phone,
      input.identity.phoneNormalized,
      input.createdAt,
      input.createdAt,
    ),
  ]
}
