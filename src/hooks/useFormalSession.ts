import { useCallback, useEffect, useRef, useState } from 'react'
import { formalSessionApi, type SessionCredentials } from '../api/formalSessionApi'
import { APP_VERSION, SCHEMA_VERSION, createSessionEventId } from '../utils/sessionData'
import {
  clearRecoveryPointer,
  IndexedDbFormalSessionStore,
  loadRecoveryPointer,
  saveRecoveryPointer,
  type FormalSessionSnapshot,
} from '../persistence/formalSessionStore'
import { FormalOutbox } from '../persistence/formalOutbox'
import type { GameState, ResearchData, ResearchStep } from '../types/game'

type Status = 'idle' | 'creating' | 'active' | 'restoring' | 'completed' | 'error'

export function useFormalSession() {
  const storeRef = useRef<IndexedDbFormalSessionStore | null>(null)
  const outboxRef = useRef<FormalOutbox | null>(null)
  const credentialsRef = useRef<SessionCredentials | null>(null)
  const seenEventsRef = useRef(new Set<string>())
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const getStore = () => (storeRef.current ??= new IndexedDbFormalSessionStore())
  const getOutbox = () => (outboxRef.current ??= new FormalOutbox(getStore(), async (item) => {
    const credentials = credentialsRef.current
    if (!credentials) throw new Error('formal session credentials unavailable')
    await formalSessionApi.upload(item, credentials.recoveryToken)
  }))

  const create = useCallback(async (researchData: ResearchData): Promise<SessionCredentials> => {
    setStatus('creating'); setError(null)
    try {
      const credentials = await formalSessionApi.create(researchData.participantId, SCHEMA_VERSION, APP_VERSION)
      credentialsRef.current = credentials
      saveRecoveryPointer(credentials)
      setStatus('active')
      return credentials
    } catch (cause) {
      setStatus('error'); setError(cause instanceof Error ? cause.message : '暂时无法创建实验会话')
      throw cause
    }
  }, [])

  const restore = useCallback(async (): Promise<FormalSessionSnapshot | null> => {
    const pointer = loadRecoveryPointer()
    if (!pointer) return null
    setStatus('restoring'); setError(null)
    try {
      const snapshot = await getStore().loadSnapshot(pointer.sessionId)
      if (!snapshot) throw new Error('本地恢复数据不存在或已损坏')
      credentialsRef.current = { ...pointer, participantId: snapshot.participantId }
      const remote = await formalSessionApi.resume(pointer.sessionId, pointer.recoveryToken)
      if (remote.status === 'completed') { clearRecoveryPointer(); setStatus('completed'); return null }
      if (remote.status !== 'in_progress' && remote.status !== 'abandoned') throw new Error(`会话状态无法恢复：${String(remote.status)}`)
      snapshot.gameState?.ratingEvents.forEach((event) => seenEventsRef.current.add(event.eventId))
      snapshot.gameState?.evidenceEvents.forEach((event) => seenEventsRef.current.add(event.eventId))
      setStatus('active')
      return snapshot
    } catch (cause) {
      setStatus('error'); setError(cause instanceof Error ? cause.message : '恢复会话失败')
      throw cause
    }
  }, [])

  const persist = useCallback(async (input: {
    researchStep: ResearchStep | null
    researchData: ResearchData
    gameState: GameState | null
  }) => {
    const credentials = credentialsRef.current
    if (!credentials) return
    const snapshot: FormalSessionSnapshot = {
      ...credentials, ...input, savedAt: new Date().toISOString(),
      technicalPauseStartedAt: null, accumulatedTechnicalPauseMs: 0,
    }
    await getStore().saveSnapshot(snapshot)
    const gameEvents = [...(input.gameState?.evidenceEvents ?? []), ...(input.gameState?.ratingEvents ?? [])]
    for (const event of gameEvents) {
      if (seenEventsRef.current.has(event.eventId)) continue
      seenEventsRef.current.add(event.eventId)
      const eventType = 'verifyType' in event ? 'verify' : 'rating'
      const payload = 'verifyType' in event
        ? { ...event, evidenceId: input.gameState?.runtime[event.candidateId]?.viewedEvidenceIds ?? [] }
        : { ...event, score: event.score }
      await getOutbox().enqueue({ eventId: event.eventId, sessionId: credentials.sessionId, kind: 'events', payload: { events: [{ eventId: event.eventId, eventType, candidateId: event.candidateId, stage: 'stage' in event ? event.stage : null, occurredAt: 'viewedAt' in event ? event.viewedAt : event.submittedAt, elapsedSec: event.elapsedSec, payload }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    for (const snapshot of input.gameState?.stageSnapshots ?? []) {
      if (seenEventsRef.current.has(snapshot.eventId)) continue
      seenEventsRef.current.add(snapshot.eventId)
      await getOutbox().enqueue({ eventId: snapshot.eventId, sessionId: credentials.sessionId, kind: 'snapshots', payload: { snapshots: [{ ...snapshot, snapshotId: snapshot.eventId }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    for (const event of input.gameState?.sunkCostEvents ?? []) {
      if (seenEventsRef.current.has(event.eventId)) continue
      seenEventsRef.current.add(event.eventId)
      await getOutbox().enqueue({ eventId: event.eventId, sessionId: credentials.sessionId, kind: 'events', payload: { events: [{ eventId: event.eventId, eventType: 'sunk_cost', occurredAt: event.selectedAt, elapsedSec: event.elapsedSec, payload: event }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    void getOutbox().flush(credentials.sessionId)
  }, [])

  const enqueue = useCallback(async (kind: Parameters<FormalOutbox['enqueue']>[0]['kind'], payload: unknown, eventId = createSessionEventId()) => {
    const credentials = credentialsRef.current
    if (!credentials) throw new Error('formal session not active')
    await getOutbox().enqueue({ eventId, sessionId: credentials.sessionId, kind, payload, queuedAt: new Date().toISOString(), attempts: 0 })
    void getOutbox().flush(credentials.sessionId)
    return eventId
  }, [])

  const flush = useCallback(() => getOutbox().flush(credentialsRef.current?.sessionId), [])
  const clear = useCallback(async () => {
    const id = credentialsRef.current?.sessionId
    if (id) await getStore().deleteSnapshot(id)
    clearRecoveryPointer(); credentialsRef.current = null; setStatus('idle')
  }, [])

  useEffect(() => {
    const online = () => { void flush() }
    const heartbeat = () => {
      const credentials = credentialsRef.current
      if (!credentials) return
      void enqueue('heartbeat', { occurredAt: new Date().toISOString(), visible: document.visibilityState === 'visible' }, `heartbeat-${Date.now()}`)
    }
    const timer = window.setInterval(heartbeat, 30_000)
    const pagehide = () => heartbeat()
    window.addEventListener('online', online)
    window.addEventListener('pagehide', pagehide)
    document.addEventListener('visibilitychange', heartbeat)
    return () => { window.clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', heartbeat) }
  }, [enqueue, flush])

  return { status, error, credentials: credentialsRef.current, create, restore, persist, enqueue, flush, clear }
}
