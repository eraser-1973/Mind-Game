import type {
  AdminAuditPage,
  AdminLoginData,
  AdminSessionData,
  AdminConfigurationDetail,
  AdminMaterialDetail,
  AdminRuleDetail,
  AdminResearchPage,
  AdminResearchSession,
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

async function sendConfigWrite<T>(path: string, method: 'POST' | 'PUT', body: unknown, idempotencyKey: string): Promise<T> {
  const token = readAdminCsrfToken()
  if (!token) throw new AdminApiError(403, 'ADMIN_CSRF_REJECTED', '管理员安全令牌缺失。', '')
  return parseResponse(await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  }))
}

async function configWrite<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const idempotencyKey = crypto.randomUUID()
  try {
    return await sendConfigWrite<T>(path, method, body, idempotencyKey)
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.code !== 'ADMIN_CSRF_REJECTED') throw error
    await getAdminSession()
    return sendConfigWrite<T>(path, method, body, idempotencyKey)
  }
}

async function configGet<T>(path: string): Promise<T> {
  return parseResponse(await fetch(path, { method: 'GET', credentials: 'include' }))
}

async function researchWrite<T>(path: string, method: 'POST' | 'DELETE', body: unknown): Promise<T> {
  const token = readAdminCsrfToken()
  if (!token) throw new AdminApiError(403, 'ADMIN_CSRF_REJECTED', '绠＄悊鍛樺畨鍏ㄤ护鐗岀己澶便€?', '')
  return parseResponse(await fetch(path, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...(path.includes('delete') || method === 'DELETE' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }, body: JSON.stringify(body) }))
}

export const adminResearchApi = {
  listSessions: (cursor: string | null = null) => configGet<AdminResearchPage>(`/api/admin/research/sessions?pageSize=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  getSession: (sessionId: string) => configGet<AdminResearchSession>(`/api/admin/research/sessions/${encodeURIComponent(sessionId)}`),
  exportAll: async () => {
    const token = readAdminCsrfToken(); if (!token) throw new AdminApiError(403, 'ADMIN_CSRF_REJECTED', '绠＄悊鍛樺畨鍏ㄤ护鐗岀己澶便€?', '')
    const response = await fetch('/api/admin/research/exports', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' })
    if (!response.ok) await parseResponse(response)
    return { blob: await response.blob(), filename: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'mind-game-research.zip' }
  },
  deleteSession: (sessionId: string) => researchWrite(`/api/admin/research/sessions/${encodeURIComponent(sessionId)}`, 'DELETE', { confirmation: `DELETE SESSION ${sessionId}`, reasonCode: 'admin_delete' }),
  bulkDelete: (sessionIds: string[]) => researchWrite('/api/admin/research/sessions/bulk-delete', 'POST', { sessionIds, confirmation: `DELETE ${sessionIds.length} SESSIONS`, reasonCode: 'admin_bulk_delete' }),
}

export const adminConfigurationApi = {
  listMaterials: () => configGet<{ items: Array<Pick<AdminMaterialDetail, 'version' | 'displayName' | 'status' | 'revision' | 'validationStatus' | 'publishedAt'> & { usedByActiveConfig: boolean }> }>('/api/admin/config/material-sets'),
  getMaterial: (version: string) => configGet<AdminMaterialDetail>(`/api/admin/config/material-sets/${encodeURIComponent(version)}`),
  cloneMaterial: (body: { version: string; displayName: string; cloneFromVersion: string }) => configWrite('/api/admin/config/material-sets', 'POST', body),
  updateMaterial: (version: string, body: { expectedRevision: number; displayName: string; document: { profiles: AdminMaterialDetail['profiles']; evidence: AdminMaterialDetail['evidence'] } }) => configWrite<AdminMaterialDetail>(`/api/admin/config/material-sets/${encodeURIComponent(version)}`, 'PUT', body),
  validateMaterial: (version: string) => configWrite<{ errors: unknown[]; warnings: unknown[] }>(`/api/admin/config/material-sets/${encodeURIComponent(version)}/validate`, 'POST', {}),
  publishMaterial: (version: string) => configWrite(`/api/admin/config/material-sets/${encodeURIComponent(version)}/publish`, 'POST', {}),
  listPointRules: () => configGet<{ items: AdminRuleDetail[] }>('/api/admin/config/point-rules'),
  listSunkRules: () => configGet<{ items: AdminRuleDetail[] }>('/api/admin/config/sunk-cost-rules'),
  getPointRule: (version: string) => configGet<AdminRuleDetail>(`/api/admin/config/point-rules/${encodeURIComponent(version)}`),
  getSunkRule: (version: string) => configGet<AdminRuleDetail>(`/api/admin/config/sunk-cost-rules/${encodeURIComponent(version)}`),
  clonePointRule: (body: { version: string; displayName: string; cloneFromVersion: string }) => configWrite('/api/admin/config/point-rules', 'POST', body),
  cloneSunkRule: (body: { version: string; displayName: string; cloneFromVersion: string }) => configWrite('/api/admin/config/sunk-cost-rules', 'POST', body),
  updatePointRule: (version: string, body: unknown) => configWrite(`/api/admin/config/point-rules/${encodeURIComponent(version)}`, 'PUT', body),
  updateSunkRule: (version: string, body: unknown) => configWrite(`/api/admin/config/sunk-cost-rules/${encodeURIComponent(version)}`, 'PUT', body),
  validatePointRule: (version: string) => configWrite(`/api/admin/config/point-rules/${encodeURIComponent(version)}/validate`, 'POST', {}),
  validateSunkRule: (version: string) => configWrite(`/api/admin/config/sunk-cost-rules/${encodeURIComponent(version)}/validate`, 'POST', {}),
  publishPointRule: (version: string) => configWrite(`/api/admin/config/point-rules/${encodeURIComponent(version)}/publish`, 'POST', {}),
  publishSunkRule: (version: string) => configWrite(`/api/admin/config/sunk-cost-rules/${encodeURIComponent(version)}/publish`, 'POST', {}),
  listConfigurations: () => configGet<{ items: AdminConfigurationDetail[] }>('/api/admin/config/configuration-sets'),
  getConfiguration: (id: string) => configGet<AdminConfigurationDetail>(`/api/admin/config/configuration-sets/${encodeURIComponent(id)}`),
  cloneConfiguration: (body: { configSetId: string; displayName: string; cloneFromConfigSetId: string }) => configWrite('/api/admin/config/configuration-sets', 'POST', body),
  updateConfiguration: (id: string, body: unknown) => configWrite(`/api/admin/config/configuration-sets/${encodeURIComponent(id)}`, 'PUT', body),
  validateConfiguration: (id: string) => configWrite(`/api/admin/config/configuration-sets/${encodeURIComponent(id)}/validate`, 'POST', {}),
  publishConfiguration: (id: string) => configWrite(`/api/admin/config/configuration-sets/${encodeURIComponent(id)}/publish`, 'POST', {}),
  activateConfiguration: (id: string) => configWrite(`/api/admin/config/configuration-sets/${encodeURIComponent(id)}/activate`, 'POST', { confirmConfigSetId: id }),
}
