import { describe, expect, it } from 'vitest'
import {
  IdentityValidationError,
  normalizeIdentity,
  validateIdentity,
} from '../worker/domain/identity'
import {
  generateCandidateDisplayOrder,
  isCandidateDisplayOrder,
} from '../worker/domain/candidateOrder'
import {
  generateSessionToken,
  hashSessionToken,
  serializeSessionCookie,
} from '../worker/domain/sessionToken'

describe('identity normalization and validation', () => {
  it('normalizes empty values to null without retaining whitespace', () => {
    expect(
      normalizeIdentity({ fullName: '  ', studentId: '', phone: '   ' }),
    ).toEqual({
      fullName: null,
      studentId: null,
      studentIdNormalized: null,
      phone: null,
      phoneNormalized: null,
    })
  })

  it('normalizes name, student ID, and international phone independently', () => {
    expect(
      validateIdentity({
        fullName: '  Ana   María  ',
        studentId: ' ab 12 ',
        phone: '+1 (202) 555-0100',
      }),
    ).toEqual({
      fullName: 'Ana María',
      studentId: 'ab 12',
      studentIdNormalized: 'AB12',
      phone: '+1 (202) 555-0100',
      phoneNormalized: '+12025550100',
    })
  })

  it('requires at least one identity field', () => {
    expect(() => validateIdentity({})).toThrowError(
      expect.objectContaining({ code: 'IDENTITY_REQUIRED', status: 400 }),
    )
  })

  it('rejects invalid phone formats without exposing the value', () => {
    try {
      validateIdentity({ phone: 'not-a-phone' })
      throw new Error('validation should fail')
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityValidationError)
      expect(error).toMatchObject({ code: 'INVALID_IDENTITY', status: 400 })
      expect(String((error as Error).message)).not.toContain('not-a-phone')
    }
  })

  it('rejects overlength name and student ID values', () => {
    expect(() => validateIdentity({ fullName: 'x'.repeat(101) })).toThrowError(
      expect.objectContaining({ code: 'INVALID_IDENTITY' }),
    )
    expect(() => validateIdentity({ studentId: 'x'.repeat(65) })).toThrowError(
      expect.objectContaining({ code: 'INVALID_IDENTITY' }),
    )
  })
})

describe('candidate order', () => {
  it('uses Fisher-Yates and always returns A-E exactly once', () => {
    const values = [0, 0, 0, 0]
    const order = generateCandidateDisplayOrder(() => values.shift() ?? 0)

    expect(order).toEqual(['B', 'C', 'D', 'E', 'A'])
    expect(isCandidateDisplayOrder(order)).toBe(true)
    expect(isCandidateDisplayOrder(['A', 'A', 'B', 'C', 'D'])).toBe(false)
    expect(isCandidateDisplayOrder(['A', 'B', 'C', 'D'])).toBe(false)
  })
})

describe('session token and cookie', () => {
  it('generates a 32-byte random token encoded as 64 lowercase hex characters', () => {
    const token = generateSessionToken((bytes) => {
      bytes.forEach((_, index) => {
        bytes[index] = index
      })
      return bytes
    })

    expect(token).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    )
  })

  it('stores a deterministic SHA-256 hash rather than the raw token', async () => {
    const hash = await hashSessionToken('test-token')

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toBe('test-token')
    expect(hash).toBe(await hashSessionToken('test-token'))
  })

  it('serializes a strict no-domain cookie and adds Secure only for HTTPS', () => {
    const local = serializeSessionCookie('abc123', false)
    const secure = serializeSessionCookie('abc123', true)

    expect(local).toContain('mg_session=abc123')
    expect(local).toContain('HttpOnly')
    expect(local).toContain('SameSite=Strict')
    expect(local).toContain('Path=/api')
    expect(local).toContain('Max-Age=86400')
    expect(local).not.toContain('Secure')
    expect(local).not.toContain('Domain=')
    expect(secure).toContain('Secure')
  })
})
