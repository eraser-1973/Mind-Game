import { describe, expect, it } from 'vitest'
import {
  deriveClientFingerprint,
  normalizeIpNetworkPrefix,
  normalizeUserAgent,
} from '../worker/security/clientFingerprint'

function request(ip: string | null, userAgent = ' Example Browser / 1.0 ') {
  const headers = new Headers({ 'User-Agent': userAgent })
  if (ip !== null) headers.set('CF-Connecting-IP', ip)
  return new Request('https://example.test/api/admin/login', { headers })
}

describe('privacy-minimized administrator client fingerprint', () => {
  it('keeps only IPv4 /24 and IPv6 /48 prefixes before hashing', () => {
    expect(normalizeIpNetworkPrefix('203.0.113.42')).toBe('ipv4:203.0.113.0/24')
    expect(normalizeIpNetworkPrefix('203.0.113.250')).toBe('ipv4:203.0.113.0/24')
    expect(normalizeIpNetworkPrefix('2001:db8:abcd:12::1')).toBe('ipv6:2001:db8:abcd::/48')
    expect(normalizeIpNetworkPrefix('2001:0db8:abcd:ffff::9')).toBe('ipv6:2001:db8:abcd::/48')
    expect(normalizeIpNetworkPrefix('invalid')).toBe('unknown')
    expect(normalizeIpNetworkPrefix(null)).toBe('unknown')
  })

  it('normalizes User-Agent only as an input to SHA-256', () => {
    expect(normalizeUserAgent(' Example\tBrowser   / 1.0 ')).toBe('example browser / 1.0')
  })

  it('returns only hashes and groups clients by minimized network prefix plus User-Agent', async () => {
    const first = await deriveClientFingerprint(request('203.0.113.42'))
    const samePrefix = await deriveClientFingerprint(request('203.0.113.250'))
    const otherPrefix = await deriveClientFingerprint(request('203.0.114.1'))

    expect(first.clientFingerprintHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.userAgentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toEqual(samePrefix)
    expect(first.clientFingerprintHash).not.toBe(otherPrefix.clientFingerprintHash)
    expect(JSON.stringify(first)).not.toContain('203.0.113')
    expect(JSON.stringify(first)).not.toContain('Example Browser')
  })
})
