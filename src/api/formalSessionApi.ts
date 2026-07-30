import type { FormalOutboxItem } from '../persistence/formalSessionStore'

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
export type SessionCredentials = { sessionId: string; recoveryToken: string; participantId: string }

const call = async <T>(path: string, init: RequestInit = {}, token?: string): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const body = await response.json() as ApiEnvelope<T>
  if (!response.ok || !body.ok) throw new Error(body.ok ? `HTTP ${response.status}` : `${body.error.code}: ${body.error.message}`)
  return body.data
}

export const formalSessionApi = {
  create(participantId: string, schemaVersion: number, appVersion: string) {
    return call<SessionCredentials>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'formal', participantId, schemaVersion: String(schemaVersion), appVersion }) })
  },
  resume(sessionId: string, token: string) { return call<Record<string, unknown>>(`/api/sessions/${sessionId}/resume`, {}, token) },
  async upload(item: FormalOutboxItem, token: string) {
    const paths = { events: 'events', snapshots: 'snapshots', heartbeat: 'heartbeat', complete: 'complete', abandon: 'abandon', client_error: '' }
    const path = item.kind === 'client_error' ? '/api/client-errors' : `/api/sessions/${item.sessionId}/${paths[item.kind]}`
    const method = item.kind === 'heartbeat' ? 'PATCH' : 'POST'
    await call(path, { method, body: JSON.stringify(item.payload), keepalive: item.kind === 'heartbeat' || item.kind === 'abandon' || item.kind === 'client_error' }, token)
  },
}
