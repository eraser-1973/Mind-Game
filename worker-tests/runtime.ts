import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const workerEntry = fileURLToPath(new URL('../worker/index.ts', import.meta.url))
const migrationPath = fileURLToPath(
  new URL('../migrations/0001_infrastructure.sql', import.meta.url),
)

let bundledWorker: Promise<string> | undefined

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

export async function createWorkerRuntime(options?: { migrate?: boolean }) {
  const runtime = new Miniflare({
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    modules: true,
    script: await getBundledWorker(),
  })
  const db = await runtime.getD1Database('DB')

  if (options?.migrate !== false) {
    const migration = await readFile(migrationPath, 'utf8')
    const statements = migration
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)

    for (const statement of statements) {
      await db.prepare(statement).run()
    }
  }

  return { runtime, db }
}
