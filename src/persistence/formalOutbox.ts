import type { FormalOutboxItem, FormalSessionStore } from './formalSessionStore'

export class FormalOutbox {
  private flushing: Promise<void> | null = null
  constructor(private store: FormalSessionStore, private upload: (item: FormalOutboxItem) => Promise<void>) {}
  async enqueue(item: FormalOutboxItem) {
    const duplicate = (await this.store.listOutbox(item.sessionId)).some((queued) => queued.eventId === item.eventId)
    if (!duplicate) await this.store.putOutbox(item)
  }
  async flush(sessionId?: string) {
    if (this.flushing) return this.flushing
    this.flushing = this.flushOnce(sessionId).finally(() => { this.flushing = null })
    return this.flushing
  }
  private async flushOnce(sessionId?: string) {
    const now = Date.now()
    for (const item of await this.store.listOutbox(sessionId)) {
      if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) continue
      try {
        await this.upload(item)
        await this.store.deleteOutbox(item.eventId)
      } catch {
        const attempts = item.attempts + 1
        const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))
        await this.store.putOutbox({ ...item, attempts, nextAttemptAt: new Date(now + delayMs).toISOString() })
      }
    }
  }
}
