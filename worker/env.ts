export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Deployment secret used only to irreversibly hash deleted session IDs. */
  TOMBSTONE_HASH_SECRET?: string
  /** Optional administrator authentication mode. Defaults to password. */
  ADMIN_AUTH_MODE?: string
}
