export const ADMIN_PASSWORD_ITERATIONS = 600000
export const ADMIN_SALT_BYTES = 16
export const ADMIN_DERIVED_KEY_BYTES = 32

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/
const DUMMY_SALT = Uint8Array.from([
  0x7b, 0x91, 0x20, 0x53, 0x8f, 0xa4, 0x11, 0x6e,
  0x3d, 0xc2, 0x75, 0x09, 0xb8, 0x44, 0xda, 0x62,
])
const DUMMY_HASH = new Uint8Array(ADMIN_DERIVED_KEY_BYTES)

export type AdminPasswordRecord = {
  passwordAlgorithm: 'PBKDF2-SHA256'
  passwordIterations: number
  passwordSaltBase64: string
  passwordHashBase64: string
}

export class AdminCredentialValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminCredentialValidationError'
  }
}

export function normalizeAdminUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function validateAdminUsername(value: string): string {
  const normalized = normalizeAdminUsername(value)
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new AdminCredentialValidationError(
      'Administrator username must be 3-64 ASCII letters, digits, dots, hyphens, or underscores.',
    )
  }
  return normalized
}

export function validateNewAdminPassword(value: string): void {
  const length = [...value].length
  if (length < 14 || length > 128 || value.trim().length === 0) {
    throw new AdminCredentialValidationError(
      'Administrator password must contain 14-128 non-whitespace Unicode characters.',
    )
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary)
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function derivePasswordBytes(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    ADMIN_DERIVED_KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

export function constantTimeEqualBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  const timingSafeEqual = (
    crypto.subtle as SubtleCrypto & {
      timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean
    }
  ).timingSafeEqual
  if (timingSafeEqual && left.length === right.length) {
    return timingSafeEqual.call(crypto.subtle, left, right)
  }

  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

export async function deriveAdminPasswordHash(
  password: string,
  salt: Uint8Array,
  iterations = ADMIN_PASSWORD_ITERATIONS,
): Promise<Uint8Array> {
  if (iterations < ADMIN_PASSWORD_ITERATIONS || salt.length < ADMIN_SALT_BYTES) {
    throw new AdminCredentialValidationError('Administrator password parameters are unsafe.')
  }
  return derivePasswordBytes(password, salt, iterations)
}

export async function createPasswordRecord(
  password: string,
): Promise<AdminPasswordRecord> {
  validateNewAdminPassword(password)
  const salt = crypto.getRandomValues(new Uint8Array(ADMIN_SALT_BYTES))
  const hash = await deriveAdminPasswordHash(password, salt)
  return {
    passwordAlgorithm: 'PBKDF2-SHA256',
    passwordIterations: ADMIN_PASSWORD_ITERATIONS,
    passwordSaltBase64: encodeBase64(salt),
    passwordHashBase64: encodeBase64(hash),
  }
}

export async function verifyAdminPassword(
  password: string,
  record: AdminPasswordRecord,
): Promise<boolean> {
  try {
    if (
      record.passwordAlgorithm !== 'PBKDF2-SHA256'
      || record.passwordIterations < ADMIN_PASSWORD_ITERATIONS
    ) return false
    const salt = decodeBase64(record.passwordSaltBase64)
    const expected = decodeBase64(record.passwordHashBase64)
    if (salt.length < ADMIN_SALT_BYTES || expected.length !== ADMIN_DERIVED_KEY_BYTES) {
      return false
    }
    const actual = await deriveAdminPasswordHash(
      password,
      salt,
      record.passwordIterations,
    )
    return constantTimeEqualBytes(actual, expected)
  } catch {
    return false
  }
}

export async function verifyDummyAdminPassword(
  password: string,
  iterations = ADMIN_PASSWORD_ITERATIONS,
): Promise<false> {
  const actual = await derivePasswordBytes(password, DUMMY_SALT, iterations)
  constantTimeEqualBytes(actual, DUMMY_HASH)
  return false
}
