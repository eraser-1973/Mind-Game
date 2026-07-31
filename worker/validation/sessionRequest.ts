import {
  IdentityValidationError,
  validateIdentity,
  type NormalizedIdentity,
} from '../domain/identity'

const MAX_BODY_BYTES = 16 * 1024
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class SessionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SessionRequestError'
  }
}

export type ValidatedCreateSessionRequest = {
  creationKey: string
  mode: 'formal'
  identity: NormalizedIdentity
  clientVersion: string | null
}

function invalidRequest(): SessionRequestError {
  return new SessionRequestError(
    400,
    'INVALID_REQUEST',
    'The session request is invalid.',
  )
}

export async function parseCreateSessionRequest(
  request: Request,
): Promise<ValidatedCreateSessionRequest> {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new SessionRequestError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json.',
    )
  }

  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new SessionRequestError(
      413,
      'REQUEST_TOO_LARGE',
      'The request body is too large.',
    )
  }

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new SessionRequestError(
      413,
      'REQUEST_TOO_LARGE',
      'The request body is too large.',
    )
  }

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new SessionRequestError(
      400,
      'INVALID_JSON',
      'The request body must contain valid JSON.',
    )
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest()
  }

  const record = body as Record<string, unknown>
  const creationKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!UUID_PATTERN.test(creationKey)) {
    throw new SessionRequestError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'A valid UUID Idempotency-Key is required.',
    )
  }

  if (record.mode !== 'formal') {
    throw new SessionRequestError(
      400,
      'INVALID_MODE',
      'Only formal sessions may be created.',
    )
  }

  let identity: NormalizedIdentity
  try {
    identity = validateIdentity(record.identity)
  } catch (error) {
    if (error instanceof IdentityValidationError) throw error
    throw invalidRequest()
  }

  const clientVersionValue = record.clientVersion
  if (
    clientVersionValue !== undefined &&
    clientVersionValue !== null &&
    typeof clientVersionValue !== 'string'
  ) {
    throw invalidRequest()
  }
  const clientVersion = clientVersionValue?.trim() || null
  if ((clientVersion?.length ?? 0) > 128) throw invalidRequest()

  return {
    creationKey: creationKey.toLowerCase(),
    mode: 'formal',
    identity,
    clientVersion,
  }
}
