import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const workerEntry = fileURLToPath(new URL('../worker/index.ts', import.meta.url))
const migrationsDirectory = fileURLToPath(
  new URL('../migrations', import.meta.url),
)

let bundledWorker: Promise<string> | undefined

function splitMigrationStatements(source: string): string[] {
  const statements: string[] = []
  let current: string[] = []
  let inTrigger = false

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed && current.length === 0) continue
    current.push(line)
    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) inTrigger = true
    const complete = inTrigger
      ? /^END;$/i.test(trimmed)
      : trimmed.endsWith(';')
    if (!complete) continue
    statements.push(current.join('\n').trim())
    current = []
    inTrigger = false
  }

  if (current.join('').trim()) statements.push(current.join('\n').trim())
  return statements
}

async function getBundledWorker(): Promise<string> {
  bundledWorker ??= build({
    entryPoints: [workerEntry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  }).then((result) => result.outputFiles[0].text)

  return bundledWorker
}

export async function createWorkerRuntime(options?: {
  migrate?: boolean
  throughMigration?: string
}) {
  const runtime = new Miniflare({
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    modules: true,
    script: await getBundledWorker(),
  })
  const db = await runtime.getD1Database('DB')

  if (options?.migrate !== false) {
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort()

    for (const name of migrationNames) {
      const migration = await readFile(join(migrationsDirectory, name), 'utf8')
      for (const statement of splitMigrationStatements(migration)) {
        await db.prepare(statement).run()
      }

      if (name === options?.throughMigration) break
    }
  }

  return { runtime, db }
}
