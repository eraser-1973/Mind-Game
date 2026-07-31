type RandomFill = (bytes: Uint8Array) => Uint8Array

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export function generateSessionToken(
  randomFill: RandomFill = (bytes) => crypto.getRandomValues(bytes),
): string {
  return bytesToHex(randomFill(new Uint8Array(32)))
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return bytesToHex(new Uint8Array(digest))
}

export function serializeSessionCookie(token: string, secure: boolean): string {
  const attributes = [
    `mg_session=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api',
    'Max-Age=86400',
  ]

  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}
