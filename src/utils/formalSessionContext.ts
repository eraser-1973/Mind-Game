import type {
  CandidateDisplayOrder,
  FormalSessionContext,
} from '../types/game'

const CANDIDATE_IDS = ['A', 'B', 'C', 'D', 'E'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isCandidateDisplayOrder(
  value: unknown,
): value is CandidateDisplayOrder {
  return (
    Array.isArray(value) &&
    value.length === CANDIDATE_IDS.length &&
    [...value].sort().join(',') === CANDIDATE_IDS.join(',')
  )
}

export function isFormalSessionContext(
  value: unknown,
): value is FormalSessionContext {
  if (!isRecord(value) || !isRecord(value.versions)) return false
  const versions = value.versions

  return (
    typeof value.participantId === 'string' &&
    value.participantId.length > 0 &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    typeof value.configSetId === 'string' &&
    value.configSetId.length > 0 &&
    isCandidateDisplayOrder(value.candidateDisplayOrder) &&
    value.initialOpenedCandidate === value.candidateDisplayOrder[0] &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    typeof versions.task === 'string' &&
    typeof versions.material === 'string' &&
    typeof versions.pointRule === 'string' &&
    typeof versions.scoring === 'string' &&
    typeof versions.benchmark === 'string' &&
    (versions.norm === null || typeof versions.norm === 'string')
  )
}
