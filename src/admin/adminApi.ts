import type {
  AdminAuditPage,
  AdminLoginData,
  AdminSessionData,
} from './adminTypes'
import { readAdminCsrfToken } from './adminCsrf'

type SuccessEnvelope<T> = { ok: true; data: T; requestId: string }
type ErrorEnvelope = {
  ok: false
  error: { code: string; message: string }
  requestId: string
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  let envelope: SuccessEnvelope<T> | ErrorEnvelope
  try {
    envelope = await response.json() as SuccessEnvelope<T> | ErrorEnvelope
  } catch {
    throw new AdminApiError(response.status, 'INVALID_ADMIN_RESPONSE', '管理员服务响应无效。', '')
  }
  if (!response.ok || !envelope.ok) {
    const error = (envelope as ErrorEnvelope).error
    const retry = response.headers.get('Retry-After')
    throw new AdminApiError(
      response.status,
      error?.code ?? 'ADMIN_REQUEST_FAILED',
      error?.message ?? '管理员请求失败。',
      envelope.requestId ?? '',
      retry && /^\d+$/.test(retry) ? Number(retry) : null,
    )
  }
  return envelope.data
}

export async function loginAdmin(username: string, password: string): Promise<AdminLoginData> {
  return parseResponse(await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }))
}

export async function getAdminSession(): Promise<AdminSessionData> {
  return parseResponse(await fetch('/api/admin/session', {
    method: 'GET',
    credentials: 'include',
  }))
}

export async function getAdminAuditLogs(options: {
  limit?: number
  cursor?: string | null
  action?: string | null
  outcome?: string | null
} = {}): Promise<AdminAuditPage> {
  const params = new URLSearchParams()
  params.set('limit', String(options.limit ?? 50))
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.action) params.set('action', options.action)
  if (options.outcome) params.set('outcome', options.outcome)
  return parseResponse(await fetch(`/api/admin/audit-logs?${params}`, {
    method: 'GET',
    credentials: 'include',
  }))
}

async function sendLogout(): Promise<{ authenticated: false; loggedOut: true }> {
  const token = readAdminCsrfToken()
  if (!token) throw new AdminApiError(403, 'ADMIN_CSRF_REJECTED', '管理员安全令牌缺失。', '')
  return parseResponse(await fetch('/api/admin/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': token },
  }))
}

export async function logoutAdmin(): Promise<{ authenticated: false; loggedOut: true }> {
  if (!readAdminCsrfToken()) await getAdminSession()
  try {
    return await sendLogout()
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.code !== 'ADMIN_CSRF_REJECTED') throw error
    await getAdminSession()
    return sendLogout()
  }
}
