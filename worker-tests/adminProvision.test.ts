import { access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The provisioning entry is intentionally plain ESM so operators can run it
// with Node without compiling Worker TypeScript first.
import {
  deriveNodePasswordRecord,
  provisionAdmin,
} from '../scripts/admin/provision-admin.mjs'

type ExistingAdmin = {
  admin_user_id: string
  username_normalized: string
  password_version: number
}

function harness(options: {
  existing?: ExistingAdmin | null
  rotate?: boolean
  username?: string
  passwords?: string[]
}) {
  const passwordValues = [...(options.passwords ?? [
    'Synthetic local password 123!',
    'Synthetic local password 123!',
  ])]
  let sql = ''
  let sqlPath = ''
  let output = ''
  return {
    captured: {
      get sql() { return sql },
      get sqlPath() { return sqlPath },
      get output() { return output },
    },
    input: {
      mode: 'local' as const,
      rotate: options.rotate ?? false,
      askUsername: async () => options.username ?? 'Stage.Admin',
      askHiddenPassword: async () => passwordValues.shift() ?? '',
      inspectAdmin: async () => options.existing ?? null,
      executeSqlFile: async (filePath: string) => {
        sqlPath = filePath
        sql = await readFile(filePath, 'utf8')
      },
      writeOutput: (value: string) => { output += value },
      now: () => '2026-08-02T00:00:00.000Z',
      randomUuid: (() => {
        let next = 0
        return () => `10000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
      })(),
      temporaryRoot: tmpdir(),
    },
  }
}

describe('offline single-administrator provisioning tool', () => {
  it('derives the same production PBKDF2 record shape without exposing a password', async () => {
    const record = await deriveNodePasswordRecord('Synthetic local password 123!')
    expect(record.passwordIterations).toBe(600000)
    expect(Buffer.from(record.passwordSaltBase64, 'base64')).toHaveLength(16)
    expect(Buffer.from(record.passwordHashBase64, 'base64')).toHaveLength(32)
    expect(JSON.stringify(record)).not.toContain('Synthetic local password 123!')
  })

  it('creates the first singleton administrator and provision audit using a deleted protected SQL file', async () => {
    const test = harness({})
    const result = await provisionAdmin(test.input)

    expect(result).toEqual({ operation: 'created', username: 'stage.admin' })
    expect(test.captured.sql).toContain('INSERT INTO admin_users')
    expect(test.captured.sql).toContain("'admin_provisioned'")
    expect(test.captured.sql).not.toContain('Synthetic local password 123!')
    expect(test.captured.output).not.toContain('Synthetic local password 123!')
    await expect(access(test.captured.sqlPath)).rejects.toThrow()
  })

  it('rejects a second administrator and refuses overwrite without explicit rotate', async () => {
    const existing = {
      admin_user_id: '20000000-0000-4000-8000-000000000001',
      username_normalized: 'stage.admin',
      password_version: 1,
    }
    const test = harness({ existing })
    await expect(provisionAdmin(test.input)).rejects.toThrow(/already exists/i)
    expect(test.captured.sql).toBe('')
  })

  it('rotates only the confirmed existing account with a new salt, version, session revocation, and audit', async () => {
    const existing = {
      admin_user_id: '20000000-0000-4000-8000-000000000001',
      username_normalized: 'stage.admin',
      password_version: 4,
    }
    const first = harness({ existing, rotate: true })
    const second = harness({ existing, rotate: true })
    await provisionAdmin(first.input)
    await provisionAdmin(second.input)

    expect(first.captured.sql).toContain('password_version = password_version + 1')
    expect(first.captured.sql).toContain("revoke_reason = 'password_rotated'")
    expect(first.captured.sql).toContain("'admin_password_rotated'")
    const saltPattern = /password_salt_base64 = '([^']+)'/
    expect(first.captured.sql.match(saltPattern)?.[1]).not.toBe(
      second.captured.sql.match(saltPattern)?.[1],
    )
    await expect(access(first.captured.sqlPath)).rejects.toThrow()
  })

  it('rejects password mismatch and a rotate username mismatch before writing SQL', async () => {
    const mismatch = harness({ passwords: ['Synthetic local password 123!', 'different value'] })
    await expect(provisionAdmin(mismatch.input)).rejects.toThrow(/match/i)
    expect(mismatch.captured.sql).toBe('')

    const wrongUser = harness({
      rotate: true,
      username: 'other.admin',
      existing: {
        admin_user_id: '20000000-0000-4000-8000-000000000001',
        username_normalized: 'stage.admin',
        password_version: 1,
      },
    })
    await expect(provisionAdmin(wrongUser.input)).rejects.toThrow(/confirm/i)
    expect(wrongUser.captured.sql).toBe('')
  })
})
