interface ApiError {
  code: string
  message: string
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')

  return new Response(JSON.stringify(body), { status, headers })
}

export function successResponse<T>(data: T, requestId: string): Response {
  return jsonResponse({ ok: true, data, requestId })
}

export function errorResponse(
  status: number,
  error: ApiError,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  return jsonResponse({ ok: false, error, requestId }, status, extraHeaders)
}
