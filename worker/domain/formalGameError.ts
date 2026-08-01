export class FormalGameError extends Error {
  constructor(
    readonly status: 409 | 500 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FormalGameError'
  }
}
