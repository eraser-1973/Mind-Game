export function readAdminCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  for (const entry of document.cookie.split(';')) {
    const [name, ...parts] = entry.trim().split('=')
    if (name === 'mg_admin_csrf') return parts.join('=') || null
  }
  return null
}
