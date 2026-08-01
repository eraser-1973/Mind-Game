import {
  readIdempotencyKey,
  readResearchJson,
  requireUuid,
  ResearchIntakeRequestError,
} from './researchIntakeRequest'

export type FormalCompletionInput = {
  eventId: string
  sessionId: string
  clientCompletedAt: string
  clientSequence: number
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(record).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function invalid(code = 'INVALID_REQUEST', message = 'The completion request is invalid.') {
  return new ResearchIntakeRequestError(400, code, message)
}

export async function parseFormalCompletionRequest(
  request: Request,
): Promise<FormalCompletionInput> {
  const eventId = readIdempotencyKey(request)
  const body = await readResearchJson(request)
  if (!hasExactKeys(body, ['sessionId', 'clientCompletedAt', 'clientSequence'])) {
    throw invalid()
  }
  if (typeof body.clientCompletedAt !== 'string' ||
    Number.isNaN(Date.parse(body.clientCompletedAt)) ||
    Date.parse(body.clientCompletedAt) > Date.now() + 24 * 60 * 60 * 1000) {
    throw invalid('INVALID_TIMESTAMP', 'A valid completion timestamp is required.')
  }
  if (!Number.isInteger(body.clientSequence) || (body.clientSequence as number) < 0) {
    throw invalid('INVALID_CLIENT_SEQUENCE', 'A non-negative client sequence is required.')
  }
  return {
    eventId,
    sessionId: requireUuid(body.sessionId),
    clientCompletedAt: body.clientCompletedAt,
    clientSequence: body.clientSequence as number,
  }
}
