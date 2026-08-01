import type {
  FormalEvidenceLevel,
  FormalEvidenceUnlockResponse,
  FormalGameStage,
  FormalStageStatus,
} from '../types/formalGame'
import type { PublicCandidateId } from '../types/game'
import type { FetchLike } from './formalResearch'
import {
  isRecord,
  parseFormalEvidenceUnlock,
  requestFormalGame,
} from './formalGame'

function isGameStage(value: unknown): value is FormalGameStage {
  return value === 'T1' || value === 'T1_COMPLETE' || value === 'T2' || value === 'T3'
}

function isStageStatus(value: unknown): value is FormalStageStatus {
  return [
    'T1_ACTIVE', 'T1_COMPLETE', 'T2_ACTIVE', 'T2_COMPLETE',
    'T3_ACTIVE', 'T3_COMPLETE',
  ].includes(String(value))
}

function parseUnlockResponse(value: unknown): FormalEvidenceUnlockResponse | null {
  const unlock = parseFormalEvidenceUnlock(value)
  if (!unlock || !isRecord(value) || !isRecord(value.points)) return null
  if (
    typeof value.created !== 'boolean' ||
    typeof value.alreadyUnlocked !== 'boolean' ||
    typeof value.sessionId !== 'string' ||
    !Number.isInteger(value.points.total) || (value.points.total as number) <= 0 ||
    !isGameStage(value.currentStage) ||
    !isStageStatus(value.stageStatus)
  ) return null
  return value as unknown as FormalEvidenceUnlockResponse
}

export function unlockFormalEvidence(
  input: {
    sessionId: string
    candidateId: PublicCandidateId
    level: FormalEvidenceLevel
    clientAt: string
    clientSequence?: number
  },
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<FormalEvidenceUnlockResponse> {
  return requestFormalGame(
    '/api/evidence/unlock', input, idempotencyKey, parseUnlockResponse, fetchImpl,
  )
}
