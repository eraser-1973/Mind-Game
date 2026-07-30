import { describe, expect, it } from 'vitest'
import { createD1Repository, type D1DatabaseLike, type SessionRow } from './repository'

describe('D1 formal session repository', () => {
  it('binds one value for every create-session SQL placeholder', async () => {
    let preparedSql = ''
    let boundValues: unknown[] = []
    const statement = {
      bind(...values: unknown[]) {
        boundValues = values
        return statement
      },
      async first<T>() { return null as T | null },
      async run<T>() { return { success: true } as { success: boolean; results?: T[] } },
    }
    const database: D1DatabaseLike = {
      prepare(sql) {
        preparedSql = sql
        return statement
      },
      async batch<T>() { return [] as { success: boolean; results?: T[] }[] },
    }
    const row: SessionRow = {
      sessionId: 'sess-local-test',
      participantId: 'MG-LOCAL-TEST',
      mode: 'formal',
      status: 'in_progress',
      schemaVersion: '1',
      appVersion: '1.1.0',
      startedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
      lastHeartbeatAt: '2026-07-30T00:00:00.000Z',
      completedAt: null,
      submissionType: null,
      finalCandidateId: null,
      finalConfidence: null,
      invalidForAssessment: 0,
      invalidReason: null,
      recoveryTokenHash: 'hash',
      finalPayloadJson: null,
    }

    await createD1Repository(database).createSession(row)

    expect(preparedSql.match(/\?/g)?.length).toBe(boundValues.length)
  })
})
