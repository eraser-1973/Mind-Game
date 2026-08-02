export class AdminOriginError extends Error {
  readonly status = 403
  readonly code = 'ADMIN_ORIGIN_REJECTED'

  constructor() {
    super('The administrator request origin was rejected.')
    this.name = 'AdminOriginError'
  }
}

export function requireSameAdminOrigin(request: Request): void {
  const supplied = request.headers.get('Origin')
  const expected = new URL(request.url).origin
  if (!supplied || supplied !== expected) throw new AdminOriginError()
}
