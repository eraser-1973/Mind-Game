import { describe, expect, it, vi } from 'vitest'
import { unlockFormalEvidence } from './formalEvidence'

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'request-1' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('formal evidence API client', () => {
  it.each([
    ['shallow', 1, 4, 'T2'],
    ['deep', 3, 1, 'T3'],
  ] as const)('submits %s intent without client-controlled evidence or points', async (level, cost, after, currentStage) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => envelope({
      created: true,
      alreadyUnlocked: false,
      sessionId: 'session-1',
      candidateId: 'A',
      level,
      ratingStage: level === 'shallow' ? 'T2' : 'T3',
      sequenceNo: 8,
      serverAt: '2026-08-01T00:01:00.000Z',
      points: { before: level === 'shallow' ? 5 : 4, cost, after, total: 5 },
      currentStage,
      stageStatus: `${currentStage}_ACTIVE`,
      evidence: [{
        id: level === 'shallow' ? 'A-t2-1' : 'A-t3-1',
        title: '材料标题', content: '材料正文', polarity: 'negative', order: 1,
      }],
    }, 201))
    const result = await unlockFormalEvidence({
      sessionId: 'session-1',
      candidateId: 'A',
      level,
      clientAt: '2026-08-01T00:00:00.000Z',
      clientSequence: 8,
    }, 'event-evidence', fetcher)
    expect(result.points).toMatchObject({ cost, after })
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(sent).toEqual({
      sessionId: 'session-1', candidateId: 'A', level,
      clientAt: '2026-08-01T00:00:00.000Z', clientSequence: 8,
    })
    expect(JSON.stringify(sent)).not.toMatch(/evidenceId|pointsBefore|pointsCost|pointsAfter/)
  })

  it('rejects a response that contains malformed evidence instead of fabricating state', async () => {
    const fetcher = vi.fn(async () => envelope({
      created: true, alreadyUnlocked: false, sessionId: 'session-1',
      candidateId: 'A', level: 'shallow', ratingStage: 'T2', sequenceNo: 8,
      serverAt: '2026-08-01T00:01:00.000Z', points: { before: 5, cost: 1, after: 4, total: 5 },
      currentStage: 'T2', stageStatus: 'T2_ACTIVE',
      evidence: [{ id: 'A-t2-1', isKeyRisk: true }],
    }))
    await expect(unlockFormalEvidence({
      sessionId: 'session-1', candidateId: 'A', level: 'shallow',
      clientAt: '2026-08-01T00:00:00.000Z',
    }, 'event-evidence', fetcher)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
