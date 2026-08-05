import { pbkdf2 as pbkdf2Callback, randomBytes, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const pbkdf2 = promisify(pbkdf2Callback)
const execFile = promisify(execFileCallback)
const ITERATIONS = 600000
const SALT_BYTES = 16
const KEY_BYTES = 32
const POLICY_VERSION = 'admin-auth-1.0.0'
const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/
const wranglerEntry = fileURLToPath(
  new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url),
)

function normalizeUsername(value) {
  const normalized = value.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error('Administrator username must be 3-64 ASCII letters, digits, dots, hyphens, or underscores.')
  }
  return normalized
}

function validatePassword(password) {
  const length = [...password].length
  if (length < 14 || length > 128 || password.trim().length === 0) {
    throw new Error('Administrator password must contain 14-128 non-whitespace Unicode characters.')
  }
}

export async function deriveNodePasswordRecord(password) {
  validatePassword(password)
  const salt = randomBytes(SALT_BYTES)
  const hash = await pbkdf2(password, salt, ITERATIONS, KEY_BYTES, 'sha256')
  return {
    passwordAlgorithm: 'PBKDF2-SHA256',
    passwordIterations: ITERATIONS,
    passwordSaltBase64: salt.toString('base64'),
    passwordHashBase64: hash.toString('base64'),
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function createSql({ username, record, now, ids }) {
  return `INSERT INTO admin_users (
  singleton_id, admin_user_id, username, username_normalized,
  password_algorithm, password_iterations, password_salt_base64,
  password_hash_base64, password_version, auth_policy_version,
  is_active, created_at, password_updated_at
) VALUES (
  1, ${sqlLiteral(ids.adminUserId)}, ${sqlLiteral(username)}, ${sqlLiteral(username)},
  'PBKDF2-SHA256', ${record.passwordIterations},
  ${sqlLiteral(record.passwordSaltBase64)}, ${sqlLiteral(record.passwordHashBase64)},
  1, '${POLICY_VERSION}', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
);

INSERT INTO admin_audit_logs (
  audit_id, admin_user_id, admin_session_id, action, outcome,
  target_type, target_id, request_id, client_fingerprint_hash,
  metadata_json, created_at
) VALUES (
  ${sqlLiteral(ids.auditId)}, ${sqlLiteral(ids.adminUserId)}, NULL,
  'admin_provisioned', 'success', 'admin_user', ${sqlLiteral(ids.adminUserId)},
  ${sqlLiteral(ids.requestId)}, NULL,
  json('{"authPolicyVersion":"${POLICY_VERSION}"}'), ${sqlLiteral(now)}
);
`
}

function rotateSql({ existing, record, now, ids }) {
  return `UPDATE admin_sessions
SET revoked_at = ${sqlLiteral(now)}, revoke_reason = 'password_rotated'
WHERE admin_user_id = ${sqlLiteral(existing.admin_user_id)} AND revoked_at IS NULL;

UPDATE admin_users
SET password_algorithm = 'PBKDF2-SHA256',
    password_iterations = ${record.passwordIterations},
    password_salt_base64 = ${sqlLiteral(record.passwordSaltBase64)},
    password_hash_base64 = ${sqlLiteral(record.passwordHashBase64)},
    password_version = password_version + 1,
    auth_policy_version = '${POLICY_VERSION}',
    password_updated_at = ${sqlLiteral(now)}
WHERE singleton_id = 1
  AND admin_user_id = ${sqlLiteral(existing.admin_user_id)}
  AND username_normalized = ${sqlLiteral(existing.username_normalized)};

INSERT INTO admin_audit_logs (
  audit_id, admin_user_id, admin_session_id, action, outcome,
  target_type, target_id, request_id, client_fingerprint_hash,
  metadata_json, created_at
) VALUES (
  ${sqlLiteral(ids.auditId)}, ${sqlLiteral(existing.admin_user_id)}, NULL,
  'admin_password_rotated', 'success', 'admin_user',
  ${sqlLiteral(existing.admin_user_id)}, ${sqlLiteral(ids.requestId)}, NULL,
  json('{"authPolicyVersion":"${POLICY_VERSION}","passwordVersion":${existing.password_version + 1}}'),
  ${sqlLiteral(now)}
);
`
}

export async function provisionAdmin(options) {
  const username = normalizeUsername(await options.askUsername())
  const existing = await options.inspectAdmin()
  if (existing && !options.rotate) {
    throw new Error('An administrator already exists; use --rotate to rotate that account.')
  }
  if (options.rotate && !existing) {
    throw new Error('No administrator exists to rotate.')
  }
  if (existing && existing.username_normalized !== username) {
    throw new Error('The supplied username does not confirm the existing administrator.')
  }

  const password = await options.askHiddenPassword('New administrator password: ')
  const confirmation = await options.askHiddenPassword('Confirm administrator password: ')
  if (password !== confirmation) throw new Error('Administrator passwords do not match.')
  const record = await deriveNodePasswordRecord(password)
  const now = options.now()
  const ids = {
    adminUserId: existing?.admin_user_id ?? options.randomUuid(),
    auditId: options.randomUuid(),
    requestId: options.randomUuid(),
  }
  const sql = existing
    ? rotateSql({ existing, record, now, ids })
    : createSql({ username, record, now, ids })

  const directory = await mkdtemp(join(options.temporaryRoot, 'mind-game-admin-'))
  const filePath = join(directory, 'provision.sql')
  try {
    await writeFile(filePath, sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await chmod(filePath, 0o600)
    await options.executeSqlFile(filePath)
  } finally {
    await rm(filePath, { force: true })
    await rm(directory, { force: true, recursive: true })
  }

  const operation = existing ? 'rotated' : 'created'
  options.writeOutput(`Administrator ${operation} successfully for ${options.mode}.\n`)
  return { operation, username }
}

async function runWrangler(args) {
  const result = await execFile(process.execPath, [wranglerEntry, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return result.stdout
}

function parseWranglerResults(output) {
  const start = output.indexOf('[')
  if (start < 0) throw new Error('Wrangler did not return JSON results.')
  const payload = JSON.parse(output.slice(start))
  return payload?.[0]?.results ?? []
}

async function inspectAdmin(mode) {
  const output = await runWrangler([
    'd1', 'execute', 'mind-game-production', `--${mode}`, '--json',
    '--command',
    'SELECT admin_user_id, username_normalized, password_version FROM admin_users WHERE singleton_id = 1;',
  ])
  return parseWranglerResults(output)[0] ?? null
}

async function executeSqlFile(mode, filePath) {
  await runWrangler([
    'd1', 'execute', 'mind-game-production', `--${mode}`, '--file', filePath,
  ])
}

async function askUsername() {
  const interfaceHandle = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await interfaceHandle.question('Administrator username: ')
  } finally {
    interfaceHandle.close()
  }
}

async function askHiddenPassword(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Administrator provisioning requires an interactive terminal.')
  }
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Provisioning cancelled.'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
        else value += character
      }
    }
    process.stdin.on('data', onData)
  })
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const mode = args.has('--remote') ? 'remote' : args.has('--local') ? 'local' : null
  const allowed = new Set(['--local', '--remote', '--rotate'])
  if (!mode || (args.has('--local') && args.has('--remote')) || [...args].some((arg) => !allowed.has(arg))) {
    throw new Error('Use exactly one of --local or --remote; --rotate is the only optional flag.')
  }
  await provisionAdmin({
    mode,
    rotate: args.has('--rotate'),
    askUsername,
    askHiddenPassword,
    inspectAdmin: () => inspectAdmin(mode),
    executeSqlFile: (filePath) => executeSqlFile(mode, filePath),
    writeOutput: (value) => process.stdout.write(value),
    now: () => new Date().toISOString(),
    randomUuid: randomUUID,
    temporaryRoot: tmpdir(),
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Administrator provisioning failed.'}\n`)
    process.exitCode = 1
  })
}

export async function readProvisionSqlForTest(filePath) {
  return readFile(filePath, 'utf8')
}
