const ADMIN_TOKEN_BYTES = 32
const ADMIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

export function generateAdminToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(ADMIN_TOKEN_BYTES)))
}

export function isAdminToken(value: string): boolean {
  return ADMIN_TOKEN_PATTERN.test(value)
}

export async function hashAdminToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const entry of header.split(';')) {
    const [cookieName, ...parts] = entry.trim().split('=')
    if (cookieName === name) return parts.join('=')
  }
  return null
}

function secureAttribute(secure: boolean): string[] {
  return secure ? ['Secure'] : []
}

export function serializeAdminSessionCookie(token: string, secure: boolean): string {
  return [
    `mg_admin=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/admin',
    'Max-Age=28800',
    ...secureAttribute(secure),
  ].join('; ')
}

export function serializeAdminCsrfCookie(token: string, secure: boolean): string {
  return [
    `mg_admin_csrf=${token}`,
    'SameSite=Strict',
    'Path=/',
    'Max-Age=28800',
    ...secureAttribute(secure),
  ].join('; ')
}

export function clearAdminSessionCookie(secure: boolean): string {
  return [
    'mg_admin=',
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/admin',
    'Max-Age=0',
    ...secureAttribute(secure),
  ].join('; ')
}

export function clearAdminCsrfCookie(secure: boolean): string {
  return [
    'mg_admin_csrf=',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
    ...secureAttribute(secure),
  ].join('; ')
}
