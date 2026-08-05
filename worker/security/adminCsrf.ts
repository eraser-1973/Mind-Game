import type { AdminContext } from '../auth/adminAuth'
import { constantTimeEqualBytes } from './adminPassword'
import { hashAdminToken, readCookie } from './adminCookies'
import { requireSameAdminOrigin } from './adminOrigin'

export class AdminCsrfError extends Error {
  readonly status = 403
  readonly code = 'ADMIN_CSRF_REJECTED'

  constructor() {
    super('The administrator CSRF validation failed.')
    this.name = 'AdminCsrfError'
  }
}

function equalText(left: string, right: string): boolean {
  return constantTimeEqualBytes(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  )
}

export async function requireAdminCsrf(
  request: Request,
  context: AdminContext,
): Promise<void> {
  try {
    requireSameAdminOrigin(request)
  } catch {
    throw new AdminCsrfError()
  }
  const cookie = readCookie(request, 'mg_admin_csrf')
  const header = request.headers.get('X-CSRF-Token')
  if (!cookie || !header || !equalText(cookie, header)) throw new AdminCsrfError()
  if (context.authMode === 'public') return
  const suppliedHash = await hashAdminToken(cookie)
  if (!equalText(suppliedHash, context.csrfTokenHash)) throw new AdminCsrfError()
}
