import type { Env } from '../env'
import { adminErrorResponse } from '../http/adminResponses'
import { handleAdminAuditLogs } from './adminAudit'
import { handleAdminLogin } from './adminLogin'
import { handleAdminLogout, handleAdminSession } from './adminSession'
import { handleAdminConfiguration } from './adminConfiguration'
import { handleAdminAnalysis } from './adminAnalysis'
import { handleAdminAnalysisParameters } from './adminAnalysisParameters'
import { handleAdminResearch } from './adminResearch'

export function handleAdminRequest(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> | Response {
  const path = new URL(request.url).pathname
  if (path === '/api/admin/login') return handleAdminLogin(request, env, requestId)
  if (path === '/api/admin/session') return handleAdminSession(request, env, requestId)
  if (path === '/api/admin/logout') return handleAdminLogout(request, env, requestId)
  if (path === '/api/admin/audit-logs') return handleAdminAuditLogs(request, env, requestId)
  if (path.startsWith('/api/admin/config/')) return handleAdminConfiguration(request, env, requestId)
  if (path.startsWith('/api/admin/analysis/norm-sets')
    || path.startsWith('/api/admin/analysis/reliability-sets')
    || path.startsWith('/api/admin/analysis/scoring-definitions')) return handleAdminAnalysisParameters(request, env, requestId)
  if (path.startsWith('/api/admin/analysis/')) return handleAdminAnalysis(request, env, requestId)
  if (path.startsWith('/api/admin/research/')) return handleAdminResearch(request, env, requestId)
  return adminErrorResponse(
    404,
    { code: 'NOT_FOUND', message: 'The requested administrator endpoint does not exist.' },
    requestId,
  )
}
