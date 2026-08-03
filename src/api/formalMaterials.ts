import type { PublicCandidateProfile } from '../types/game'

type ApiEnvelope<T> = {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string }
}
export class FormalMaterialsApiError extends Error {
  constructor(readonly code: string) {
    super('正式测评候选人资料暂时无法读取。')
    this.name = 'FormalMaterialsApiError'
  }
}

export async function getFormalMaterials(sessionId: string): Promise<{
  sessionId: string
  materialVersion: string
  candidates: PublicCandidateProfile[]
}> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/materials`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  const body = await response.json() as ApiEnvelope<{
    sessionId: string
    materialVersion: string
    candidates: PublicCandidateProfile[]
  }>
  if (!response.ok || !body.ok || !body.data) {
    throw new FormalMaterialsApiError(body.error?.code ?? 'MATERIALS_READ_FAILED')
  }
  return body.data
}
