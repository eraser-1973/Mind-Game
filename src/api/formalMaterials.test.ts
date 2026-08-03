import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFormalMaterials } from './formalMaterials'

afterEach(() => vi.unstubAllGlobals())

describe('formal materials client', () => {
  it('loads session-scoped materials without browser storage or Quick fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: { sessionId: 'session-1', materialVersion: 'material-1.0.0', candidates: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getFormalMaterials('session-1')).resolves.toMatchObject({
      sessionId: 'session-1', materialVersion: 'material-1.0.0', candidates: [],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1/materials', expect.objectContaining({
      method: 'GET', credentials: 'same-origin',
    }))
  })
})
