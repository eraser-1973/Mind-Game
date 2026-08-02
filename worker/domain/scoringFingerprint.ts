function normalizeCanonical(
  value: unknown,
  seen: WeakSet<object>,
): null | boolean | number | string | unknown[] | Record<string, unknown> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical numbers must be finite')
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') {
    throw new Error(`unsupported canonical value type: ${typeof value}`)
  }
  if (seen.has(value)) throw new Error('cyclic canonical input is not supported')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new Error('sparse arrays are not canonical')
      }
      return value.map((item) => normalizeCanonical(item, seen))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('only plain objects can be canonicalized')
    }
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeCanonical(
        (value as Record<string, unknown>)[key],
        seen,
      )
    }
    return normalized
  } finally {
    seen.delete(value)
  }
}

export function canonicalizeScoringInput(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value, new WeakSet()))
}

export async function fingerprintScoringInput(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeScoringInput(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
