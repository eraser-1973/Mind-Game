import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_DERIVED_KEY_BYTES,
  ADMIN_PASSWORD_ITERATIONS,
  ADMIN_SALT_BYTES,
  constantTimeEqualBytes,
  createPasswordRecord,
  decodeBase64,
  encodeBase64,
  normalizeAdminUsername,
  validateAdminUsername,
  validateNewAdminPassword,
  verifyAdminPassword,
  verifyDummyAdminPassword,
} from '../worker/security/adminPassword'

describe('administrator password security', () => {
  it('normalizes and validates case-insensitive administrator usernames', () => {
    expect(normalizeAdminUsername('  Stage.Admin_1  ')).toBe('stage.admin_1')
    expect(validateAdminUsername('Stage.Admin_1')).toBe('stage.admin_1')
    for (const value of ['ab', 'a'.repeat(65), 'admin name', '管理员']) {
      expect(() => validateAdminUsername(value)).toThrow()
    }
  })

  it('requires 14-128 non-whitespace Unicode characters for a new password', () => {
    expect(() => validateNewAdminPassword('A secure test 密码 123')).not.toThrow()
    for (const value of ['', ' '.repeat(14), 'short-passwd', '密'.repeat(129)]) {
      expect(() => validateNewAdminPassword(value)).toThrow()
    }
  })

  it('uses a fresh 16-byte salt, 600000 iterations, and a 32-byte derived key', async () => {
    const first = await createPasswordRecord('Synthetic password 123!')
    const second = await createPasswordRecord('Synthetic password 123!')

    expect(ADMIN_PASSWORD_ITERATIONS).toBe(600000)
    expect(ADMIN_SALT_BYTES).toBe(16)
    expect(ADMIN_DERIVED_KEY_BYTES).toBe(32)
    expect(first).toMatchObject({
      passwordAlgorithm: 'PBKDF2-SHA256',
      passwordIterations: 600000,
    })
    expect(decodeBase64(first.passwordSaltBase64)).toHaveLength(16)
    expect(decodeBase64(first.passwordHashBase64)).toHaveLength(32)
    expect(first.passwordSaltBase64).not.toBe(second.passwordSaltBase64)
    expect(first.passwordHashBase64).not.toBe(second.passwordHashBase64)
  })

  it('verifies correct passwords, rejects wrong ones, and preserves Base64 bytes', async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index)
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)

    const record = await createPasswordRecord('Synthetic password 123!')
    await expect(verifyAdminPassword('Synthetic password 123!', record)).resolves.toBe(true)
    await expect(verifyAdminPassword('Synthetic password 124!', record)).resolves.toBe(false)
  })

  it('uses the constant-time byte helper and performs dummy PBKDF2 for an unknown username', async () => {
    expect(constantTimeEqualBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true)
    expect(constantTimeEqualBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false)
    expect(constantTimeEqualBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBe(false)

    const subtleSpy = vi.spyOn(crypto.subtle, 'deriveBits')
    await expect(verifyDummyAdminPassword('Unknown account password')).resolves.toBe(false)
    expect(subtleSpy).toHaveBeenCalledTimes(1)
    const algorithm = subtleSpy.mock.calls[0][0] as { iterations: number }
    expect(algorithm.iterations).toBe(600000)
  })
})
