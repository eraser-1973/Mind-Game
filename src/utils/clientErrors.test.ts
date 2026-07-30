import { describe, expect, it } from 'vitest'
import { buildClientError } from './clientErrors'

describe('buildClientError', () => {
  it('creates an anonymous, versioned assessment error record', () => {
    const record = buildClientError(new Error('asset failed'), {
      sessionId: 'ses_123456789012',
      errorType: 'resource',
      fatal: true,
      route: '/assessment',
      occurredAt: '2026-07-30T10:00:00.000Z',
    })

    expect(record.errorId).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.sessionId).toBe('ses_123456789012')
    expect(record.message).toBe('asset failed')
    expect(record.fatal).toBe(true)
    expect(record.affectedAssessment).toBe(true)
    expect(record).not.toHaveProperty('email')
    expect(record).not.toHaveProperty('ip')
  })
})
