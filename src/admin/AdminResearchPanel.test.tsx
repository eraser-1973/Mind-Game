import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminResearchPanel } from './AdminResearchPanel'
import { AdminDashboard } from './AdminDashboard'

let renderer: ReactTestRenderer | undefined
let originalDocument: typeof globalThis.document | undefined
let originalFetch: typeof globalThis.fetch | undefined

const sessionId = '11111111-1111-4111-8111-111111111111'
const item = {
  sessionId,
  participantId: 'participant-1',
  identity: { name: 'A*', studentId: 'ST***', phone: '*******1234' },
  status: 'completed', currentStep: 'completed', startedAt: '2026-08-05T00:00:00.000Z', endedAt: '2026-08-05T00:15:00.000Z',
  completionType: 'manual', taskVersion: 'task-1', materialVersion: 'material-1', configVersion: 'config-1', qualityFlags: [],
}

function response(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, requestId: 'research-ui-test' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  originalDocument = globalThis.document
  originalFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'mg_admin_csrf=csrf-safe-value' } })
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path.startsWith('/api/admin/research/sessions?')) return response({ items: [item], nextCursor: null })
    if (path === `/api/admin/research/sessions/${sessionId}`) return response(item)
    return response({})
  })
})

afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('research record administration', () => {
  it('opens a masked session detail from the records table', async () => {
    await act(async () => { renderer = create(<AdminResearchPanel />) })
    const detailButton = renderer!.root.findByProps({ 'data-testid': `admin-research-detail-${sessionId}` })
    await act(async () => detailButton.props.onClick())
    expect(JSON.stringify(renderer!.toJSON())).toContain('*******1234')
  })

  it('provides a distinct export-data section in the administrator dashboard', () => {
    renderer = create(<AdminDashboard
      session={{ authenticated: true, admin: { username: 'Admin' }, session: { createdAt: '', lastSeenAt: '', idleExpiresAt: '', absoluteExpiresAt: '' } }}
      audits={[]}
      nextCursor={null}
      loadingMore={false}
      onLoadMore={async () => {}}
      onLogout={async () => {}}
    />)
    expect(renderer.root.findByProps({ 'data-testid': 'admin-research-export-tab' })).toBeTruthy()
  })
})
