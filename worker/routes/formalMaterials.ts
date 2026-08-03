import { authenticateFormalSession, SessionAuthError } from '../auth/sessionAuth'
import type { Env } from '../env'
import { errorResponse, successResponse } from '../http/responses'

type ProfileRow = {
  candidate_id: string
  name: string
  role: string
  school: string
  visible_halo_json: string
  resume_summary: string
  education: string
  skills_json: string
  experiences_json: string
  initial_image: string
  public_tags_json: string
}
export async function handleFormalMaterials(
  request: Request,
  env: Env,
  requestId: string,
  sessionId: string,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse(405, { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is allowed.' }, requestId, { Allow: 'GET' })
  }
  try {
    const session = await authenticateFormalSession(request, env.DB, sessionId)
    const material = await env.DB.prepare(
      `SELECT material_version FROM material_sets
       WHERE material_version = ? AND status = 'published'`,
    ).bind(session.materialVersion).first<{ material_version: string }>()
    if (!material) {
      return errorResponse(409, {
        code: 'MATERIAL_NOT_READY',
        message: 'The material pinned to this formal session is not available.',
      }, requestId)
    }
    const rows = await env.DB.prepare(
      `SELECT candidate_id,name,role,school,visible_halo_json,resume_summary,
              education,skills_json,experiences_json,initial_image,public_tags_json
       FROM candidate_material_profiles
       WHERE material_version = ?`,
    ).bind(session.materialVersion).all<ProfileRow>()
    if (rows.results.length !== 5) {
      return errorResponse(409, {
        code: 'MATERIAL_NOT_READY',
        message: 'The material pinned to this formal session is incomplete.',
      }, requestId)
    }
    const byId = new Map(rows.results.map((row) => [row.candidate_id, row]))
    const order = JSON.parse(session.candidateDisplayOrder) as string[]
    const candidates = order.map((candidateId) => {
      const row = byId.get(candidateId)
      if (!row) throw new Error('missing profile')
      return {
        id: row.candidate_id,
        name: row.name,
        role: row.role,
        school: row.school,
        visibleHalo: JSON.parse(row.visible_halo_json) as string[],
        resumeSummary: row.resume_summary,
        education: row.education,
        skills: JSON.parse(row.skills_json) as string[],
        experiences: JSON.parse(row.experiences_json) as Array<{ title: string; content: string }>,
        initialImage: row.initial_image,
        tags: JSON.parse(row.public_tags_json) as string[],
      }
    })
    return successResponse({
      sessionId: session.sessionId,
      materialVersion: session.materialVersion,
      candidates,
    }, requestId)
  } catch (error) {
    if (error instanceof SessionAuthError) {
      return errorResponse(error.status, { code: error.code, message: error.message }, requestId)
    }
    return errorResponse(500, {
      code: 'MATERIALS_READ_FAILED',
      message: 'The formal session material could not be read.',
    }, requestId)
  }
}
