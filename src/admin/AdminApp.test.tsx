import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApp } from './AdminApp'
import { AdminDashboard } from './AdminDashboard'
import { AdminLoginScreen } from './AdminLoginScreen'

let renderer: ReactTestRenderer | undefined
let originalFetch: typeof globalThis.fetch | undefined
let originalDocument: typeof globalThis.document | undefined
let originalWindow: typeof globalThis.window | undefined

function envelope(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(status < 400
    ? { ok: true, data, requestId: 'request-admin' }
    : { ok: false, error: data, requestId: 'request-admin' }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const sessionData = {
  authenticated: true,
  admin: { username: 'Stage.Admin' },
  session: {
    createdAt: '2026-08-02T00:00:00.000Z',
    lastSeenAt: '2026-08-02T00:10:00.000Z',
    idleExpiresAt: '2026-08-02T00:40:00.000Z',
    absoluteExpiresAt: '2026-08-02T08:00:00.000Z',
  },
}

beforeEach(() => {
  originalFetch = globalThis.fetch
  originalDocument = globalThis.document
  originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'mg_admin_csrf=csrf-safe-value' },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: vi.fn(), setItem: vi.fn() }, sessionStorage: { getItem: vi.fn(), setItem: vi.fn() } },
  })
})

afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = undefined
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  if (originalFetch) globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function renderAdmin() {
  await act(async () => { renderer = create(<AdminApp />) })
  return renderer!
}

describe('isolated administrator application', () => {
  it('shows a safe login form for an unauthenticated session', async () => {
    globalThis.fetch = vi.fn(async () => envelope({
      code: 'ADMIN_UNAUTHORIZED', message: 'Unauthorized.',
    }, 401))
    await renderAdmin()
    const screen = renderer!.root.findByType(AdminLoginScreen)
    const username = screen.findByProps({ name: 'username' })
    const password = screen.findByProps({ name: 'password' })
    expect(username.props.autoComplete).toBe('username')
    expect(password.props.type).toBe('password')
    expect(password.props.autoComplete).toBe('current-password')
  })

  it('shows one generic error, clears the password, and disables the button while logging in', async () => {
    let resolveLogin: ((value: Response) => void) | undefined
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/session')) {
        return envelope({ code: 'ADMIN_UNAUTHORIZED', message: 'Unauthorized.' }, 401)
      }
      return new Promise<Response>((resolve) => { resolveLogin = resolve })
    })
    await renderAdmin()
    const screen = renderer!.root.findByType(AdminLoginScreen)
    act(() => screen.props.onUsernameChange('missing.admin'))
    act(() => screen.props.onPasswordChange('Synthetic local password 123!'))
    let promise: Promise<void>
    act(() => { promise = screen.props.onSubmit() })
    expect(renderer!.root.findByType(AdminLoginScreen).props.submitting).toBe(true)
    await act(async () => {
      resolveLogin?.(envelope({ code: 'INVALID_ADMIN_CREDENTIALS', message: 'Invalid.' }, 401))
      await promise!
    })
    const failed = renderer!.root.findByType(AdminLoginScreen)
    expect(failed.props.error).toBe('用户名或密码不正确。')
    expect(failed.props.password).toBe('')
  })

  it('shows a rate-limit message without exposing credential details', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) return envelope({ code: 'ADMIN_UNAUTHORIZED', message: 'Unauthorized.' }, 401)
      return envelope(
        { code: 'ADMIN_LOGIN_RATE_LIMITED', message: 'Limited.' },
        429,
        { 'Retry-After': '120' },
      )
    })
    await renderAdmin()
    await act(async () => renderer!.root.findByType(AdminLoginScreen).props.onSubmit())
    expect(renderer!.root.findByType(AdminLoginScreen).props.error)
      .toContain('尝试次数过多，请稍后再试')
  })

  it('shows only the minimal dashboard, safe audit data, pagination, and logout', async () => {
    const paths: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      paths.push(path)
      if (path === '/api/admin/session') return envelope(sessionData)
      if (path.startsWith('/api/admin/audit-logs')) return envelope({
        items: [{
          auditId: path.includes('cursor=') ? 'audit-2' : 'audit-1', action: 'admin_login_success', outcome: 'success',
          targetType: null, targetId: null, requestId: 'request-1',
          createdAt: '2026-08-02T00:10:00.000Z',
          metadata: { authPolicyVersion: 'admin-auth-1.0.0' },
        }],
        nextCursor: path.includes('cursor=') ? null : 'next-safe-cursor',
      })
      if (path === '/api/admin/config/material-sets') return envelope({ items: [] })
      if (path === '/api/admin/config/point-rules') return envelope({ items: [] })
      if (path === '/api/admin/config/sunk-cost-rules') return envelope({ items: [] })
      if (path === '/api/admin/config/configuration-sets') return envelope({ items: [{
        configSetId: 'config-2026-07-v1', displayName: '当前正式预实验配置',
        sourceConfigSetId: null, status: 'published', active: true, revision: 1,
        validationStatus: 'valid', validationReport: { errors: [], warnings: [] },
        fingerprint: 'a'.repeat(64), taskVersion: 'task-1.0.0', materialVersion: 'material-1.0.0',
        pointRuleVersion: 'points-5-v1', sunkCostRuleVersion: 'sunk-1.0.0',
        scoringVersion: 'RDI-2.0-prepilot', benchmarkVersion: 'benchmark-1.0.0',
        normVersion: null, publishedAt: '2026-08-02T00:00:00.000Z', activatedAt: '2026-08-02T00:00:00.000Z',
      }] })
      return envelope({ authenticated: false, loggedOut: true })
    })
    await renderAdmin()
    const dashboard = renderer!.root.findByType(AdminDashboard)
    expect(dashboard.props.session.admin.username).toBe('Stage.Admin')
    const serialized = JSON.stringify(renderer!.toJSON())
    expect(serialized).toContain('管理员控制台')
    expect(serialized).toContain('安全认证基础已启用')
    expect(serialized).not.toMatch(/姓名|学号|手机号|问卷/)

    await act(async () => dashboard.props.onLoadMore())
    expect(paths.some((path) => path.includes('cursor=next-safe-cursor'))).toBe(true)
    await act(async () => renderer!.root.findByType(AdminDashboard).props.onLogout())
    expect(paths).toContain('/api/admin/logout')
    expect(renderer!.root.findAllByType(AdminLoginScreen)).toHaveLength(1)
  })
})
