function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

function ipv4Prefix(value: string): string | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet, index) => (
    !Number.isInteger(octet)
    || octet < 0
    || octet > 255
    || String(octet) !== parts[index]
  ))) return null
  return `ipv4:${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

function ipv6Prefix(value: string): string | null {
  const input = value.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!input.includes(':') || input.includes('.')) return null
  const halves = input.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (
    groups.length !== 8
    || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) return null
  const prefix = groups.slice(0, 3).map((group) => Number.parseInt(group, 16).toString(16))
  return `ipv6:${prefix.join(':')}::/48`
}

export function normalizeIpNetworkPrefix(value: string | null): string {
  if (!value) return 'unknown'
  const input = value.trim()
  return ipv4Prefix(input) ?? ipv6Prefix(input) ?? 'unknown'
}

export function normalizeUserAgent(value: string | null): string {
  return (value ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 512) || 'unknown'
}

export type AdminClientFingerprint = {
  clientFingerprintHash: string
  userAgentHash: string
}

export async function deriveClientFingerprint(
  request: Request,
): Promise<AdminClientFingerprint> {
  const prefix = normalizeIpNetworkPrefix(request.headers.get('CF-Connecting-IP'))
  const userAgent = normalizeUserAgent(request.headers.get('User-Agent'))
  const [clientFingerprintHash, userAgentHash] = await Promise.all([
    sha256(`${prefix}\n${userAgent}`),
    sha256(userAgent),
  ])
  return { clientFingerprintHash, userAgentHash }
}

export async function hashAdminUsername(normalizedUsername: string): Promise<string> {
  return sha256(normalizedUsername)
}
