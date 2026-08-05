export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Deployment secret used only to irreversibly hash deleted session IDs. */
  TOMBSTONE_HASH_SECRET?: string
}
