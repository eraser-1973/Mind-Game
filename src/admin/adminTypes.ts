export type AdminSessionData = {
  authenticated: true
  admin: { username: string }
  session: {
    createdAt: string
    lastSeenAt: string
    idleExpiresAt: string
    absoluteExpiresAt: string
  }
}

export type AdminLoginData = {
  authenticated: true
  admin: { username: string }
  session: {
    createdAt: string
    absoluteExpiresAt: string
    idleTimeoutSec: number
  }
  authPolicyVersion: string
}

export type AdminAuditItem = {
  auditId: string
  action: string
  outcome: 'success' | 'failure' | 'blocked'
  targetType: string | null
  targetId: string | null
  requestId: string
  createdAt: string
  metadata: Record<string, string | number | boolean | null>
}

export type AdminAuditPage = {
  items: AdminAuditItem[]
  nextCursor: string | null
}
