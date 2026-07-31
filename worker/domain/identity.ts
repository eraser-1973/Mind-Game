export type IdentityInput = {
  fullName?: string | null
  studentId?: string | null
  phone?: string | null
}

export type NormalizedIdentity = {
  fullName: string | null
  studentId: string | null
  studentIdNormalized: string | null
  phone: string | null
  phoneNormalized: string | null
}

export class IdentityValidationError extends Error {
  readonly status = 400

  constructor(
    readonly code: 'IDENTITY_REQUIRED' | 'INVALID_IDENTITY',
    message: string,
  ) {
    super(message)
    this.name = 'IdentityValidationError'
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeIdentity(input: IdentityInput): NormalizedIdentity {
  const rawName = emptyToNull(input.fullName)
  const fullName = rawName?.replace(/\s+/gu, ' ') ?? null
  const studentId = emptyToNull(input.studentId)
  const phone = emptyToNull(input.phone)

  return {
    fullName,
    studentId,
    studentIdNormalized: studentId?.replace(/\s+/gu, '').toUpperCase() ?? null,
    phone,
    phoneNormalized: phone?.replace(/[\s\-()]/gu, '') ?? null,
  }
}

function assertInputShape(input: unknown): asserts input is IdentityInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new IdentityValidationError(
      'INVALID_IDENTITY',
      'Identity information is invalid.',
    )
  }

  for (const key of ['fullName', 'studentId', 'phone'] as const) {
    const value = (input as Record<string, unknown>)[key]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new IdentityValidationError(
        'INVALID_IDENTITY',
        'Identity information is invalid.',
      )
    }
  }
}

export function validateIdentity(input: unknown): NormalizedIdentity {
  assertInputShape(input)
  const normalized = normalizeIdentity(input)

  if (
    normalized.fullName === null &&
    normalized.studentId === null &&
    normalized.phone === null
  ) {
    throw new IdentityValidationError(
      'IDENTITY_REQUIRED',
      'At least one identity field is required.',
    )
  }

  if (
    (normalized.fullName?.length ?? 0) > 100 ||
    (normalized.studentId?.length ?? 0) > 64 ||
    (normalized.phoneNormalized !== null &&
      !/^\+?[0-9]{6,20}$/.test(normalized.phoneNormalized))
  ) {
    throw new IdentityValidationError(
      'INVALID_IDENTITY',
      'Identity information is invalid.',
    )
  }

  return normalized
}
