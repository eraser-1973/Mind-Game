import { generateCandidateDisplayOrder } from '../domain/candidateOrder'
import { generateSessionToken, hashSessionToken } from '../domain/sessionToken'
import { findActiveConfigurationSet } from '../repositories/configurationSets'
import {
  buildParticipantInsertStatements,
  findDuplicateIdentitySummary,
} from '../repositories/participants'
import {
  buildSessionInsertStatements,
  findSessionByCreationKey,
  projectSafeSession,
  rotateSessionCredential,
  type SafeSessionData,
  type SessionRow,
} from '../repositories/sessions'
import type { ValidatedCreateSessionRequest } from '../validation/sessionRequest'

export class SessionCreationError extends Error {
  constructor(
    readonly status: 500 | 503,
    readonly code: 'SESSION_CREATE_FAILED' | 'CONFIG_NOT_READY',
    message: string,
  ) {
    super(message)
    this.name = 'SessionCreationError'
  }
}

export type SessionCreationResult = {
  created: boolean
  token: string
  data: SafeSessionData
}

async function replaySession(
  db: D1Database,
  row: SessionRow,
): Promise<SessionCreationResult> {
  const token = generateSessionToken()
  const tokenHash = await hashSessionToken(token)
  await rotateSessionCredential(db, row.session_id, tokenHash, new Date().toISOString())

  return {
    created: false,
    token,
    data: projectSafeSession(row),
  }
}

export async function createOrReplayFormalSession(
  db: D1Database,
  request: ValidatedCreateSessionRequest,
): Promise<SessionCreationResult> {
  try {
    const existing = await findSessionByCreationKey(db, request.creationKey)
    if (existing) return await replaySession(db, existing)

    const config = await findActiveConfigurationSet(db)
    if (!config) {
      throw new SessionCreationError(
        503,
        'CONFIG_NOT_READY',
        'Formal session configuration is not ready.',
      )
    }

    const duplicates = await findDuplicateIdentitySummary(db, request.identity)
    const createdAt = new Date().toISOString()
    const participantId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const candidateDisplayOrder = generateCandidateDisplayOrder()
    const token = generateSessionToken()
    const tokenHash = await hashSessionToken(token)

    const statements = [
      ...buildParticipantInsertStatements(db, {
        participantId,
        identity: request.identity,
        createdAt,
      }),
      ...buildSessionInsertStatements(db, {
        sessionId,
        participantId,
        creationKey: request.creationKey,
        config,
        candidateDisplayOrder,
        clientVersion: request.clientVersion,
        duplicates,
        tokenHash,
        createdAt,
      }),
    ]

    try {
      await db.batch(statements)
    } catch {
      const winner = await findSessionByCreationKey(db, request.creationKey)
      if (winner) return await replaySession(db, winner)
      throw new SessionCreationError(
        500,
        'SESSION_CREATE_FAILED',
        'The formal session could not be created.',
      )
    }

    return {
      created: true,
      token,
      data: {
        participantId,
        sessionId,
        mode: 'formal',
        configSetId: config.configSetId,
        versions: {
          task: config.taskVersion,
          material: config.materialVersion,
          pointRule: config.pointRuleVersion,
          scoring: config.scoringVersion,
          benchmark: config.benchmarkVersion,
          norm: config.normVersion,
        },
        candidateDisplayOrder,
        initialOpenedCandidate: candidateDisplayOrder[0],
        currentStep: 'demographics',
        createdAt,
      },
    }
  } catch (error) {
    if (error instanceof SessionCreationError) throw error
    throw new SessionCreationError(
      500,
      'SESSION_CREATE_FAILED',
      'The formal session could not be created.',
    )
  }
}
