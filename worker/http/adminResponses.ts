type AdminApiError = { code: string; message: string }

function adminHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('Pragma', 'no-cache')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  return headers
}

export function adminSuccessResponse<T>(
  data: T,
  requestId: string,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify({ ok: true, data, requestId }), {
    status,
    headers: adminHeaders(extraHeaders),
  })
}

export function adminErrorResponse(
  status: number,
  error: AdminApiError,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify({ ok: false, error, requestId }), {
    status,
    headers: adminHeaders(extraHeaders),
  })
}
