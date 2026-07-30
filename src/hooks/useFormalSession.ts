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
import { buildClientError } from '../utils/clientErrors'

type Status = 'idle' | 'creating' | 'active' | 'restoring' | 'completed' | 'error'

export function useFormalSession() {
  const storeRef = useRef<IndexedDbFormalSessionStore | null>(null)
  const outboxRef = useRef<FormalOutbox | null>(null)
  const credentialsRef = useRef<SessionCredentials | null>(null)
  const completionQueuedRef = useRef(false)
  const seenEventsRef = useRef(new Set<string>())
  const heartbeatStateRef = useRef<{
    researchStep: ResearchStep | null
    gamePhase: GameState['phase'] | null
    elapsedSec: number
  }>({ researchStep: null, gamePhase: null, elapsedSec: 0 })
  const lastApiErrorAtRef = useRef(0)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const getStore = () => (storeRef.current ??= new IndexedDbFormalSessionStore())
  const getOutbox = () => (outboxRef.current ??= new FormalOutbox(getStore(), async (item) => {
    const credentials = credentialsRef.current
    if (!credentials) throw new Error('formal session credentials unavailable')
    try {
      await formalSessionApi.upload(item, credentials.recoveryToken)
    } catch (cause) {
      const now = Date.now()
      if (item.kind !== 'client_error' && now - lastApiErrorAtRef.current > 30_000) {
        lastApiErrorAtRef.current = now
        const error = buildClientError(cause, {
          sessionId: credentials.sessionId,
          errorType: 'api',
          fatal: false,
          affectedAssessment: false,
        })
        await getStore().putOutbox({
          eventId: error.errorId,
          sessionId: credentials.sessionId,
          kind: 'client_error',
          payload: error,
          queuedAt: error.occurredAt,
          attempts: 0,
        })
      }
      throw cause
    }
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
      if (remote.status !== 'in_progress' && remote.status !== 'technical_error') throw new Error(`会话状态无法恢复：${String(remote.status)}`)
      if (remote.status === 'technical_error' && snapshot.gameState) {
        snapshot.gameState.invalidForAssessment = true
        snapshot.gameState.invalidReason ??= '会话曾发生严重技术错误。'
      }
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
    heartbeatStateRef.current = {
      researchStep: input.researchStep,
      gamePhase: input.gameState?.phase ?? null,
      elapsedSec: input.gameState?.elapsedSec ?? 0,
    }
    const snapshot: FormalSessionSnapshot = {
      ...credentials, ...input, savedAt: new Date().toISOString(),
      technicalPauseStartedAt: input.gameState?.technicalPauseStartedAt ?? null,
      accumulatedTechnicalPauseMs: input.gameState?.technicalPauseMs ?? 0,
    }
    await getStore().saveSnapshot(snapshot)
    const gameEvents = [...(input.gameState?.evidenceEvents ?? []), ...(input.gameState?.ratingEvents ?? [])]
    for (const event of gameEvents) {
      if (seenEventsRef.current.has(event.eventId)) continue
      seenEventsRef.current.add(event.eventId)
      const eventType = 'verifyType' in event ? 'verify' : 'rating'
      const payload = 'verifyType' in event
        ? { ...event, sessionId: credentials.sessionId, evidenceId: event.evidenceIds ?? [event.evidenceId] }
        : { ...event, sessionId: credentials.sessionId, score: event.score }
      await getOutbox().enqueue({ eventId: event.eventId, sessionId: credentials.sessionId, kind: 'events', payload: { events: [{ eventId: event.eventId, eventType, candidateId: event.candidateId, stage: 'stage' in event ? event.stage : null, occurredAt: 'viewedAt' in event ? event.viewedAt : event.submittedAt, elapsedSec: event.elapsedSec, payload }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    for (const snapshot of input.gameState?.stageSnapshots ?? []) {
      if (seenEventsRef.current.has(snapshot.eventId)) continue
      seenEventsRef.current.add(snapshot.eventId)
      await getOutbox().enqueue({ eventId: snapshot.eventId, sessionId: credentials.sessionId, kind: 'snapshots', payload: { snapshots: [{ ...snapshot, snapshotId: snapshot.eventId }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    for (const event of input.gameState?.sunkCostEvents ?? []) {
      const version = [event.subsequentAdditionalPoints, event.subsequentCandidateSwitches, event.subsequentRatingChanges, event.finalCandidateId ?? 'pending'].join('-')
      const uploadId = `${event.eventId}-${version}`
      if (seenEventsRef.current.has(uploadId)) continue
      seenEventsRef.current.add(uploadId)
      await getOutbox().enqueue({ eventId: uploadId, sessionId: credentials.sessionId, kind: 'events', payload: { events: [{ eventId: uploadId, eventType: 'sunk_cost', occurredAt: event.selectedAt, elapsedSec: event.elapsedSec, payload: { ...event, sessionId: credentials.sessionId } }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    for (const log of input.gameState?.logs ?? []) {
      if (seenEventsRef.current.has(log.id)) continue
      seenEventsRef.current.add(log.id)
      await getOutbox().enqueue({ eventId: log.id, sessionId: credentials.sessionId, kind: 'events', payload: { events: [{ eventId: log.id, eventType: `game_log_${log.type}`, candidateId: log.candidateId, occurredAt: new Date(Date.parse(input.researchData.startedAt) + log.elapsedSec * 1_000).toISOString(), elapsedSec: log.elapsedSec, payload: log }] }, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    const finalDecision = input.gameState?.finalDecision
    if (finalDecision && !seenEventsRef.current.has(finalDecision.eventId)) {
      seenEventsRef.current.add(finalDecision.eventId)
      await getOutbox().enqueue({ eventId: finalDecision.eventId, sessionId: credentials.sessionId, kind: 'events', payload: { events: [{ eventId: finalDecision.eventId, eventType: 'final_decision', candidateId: finalDecision.candidateId, stage: 'FINAL', occurredAt: finalDecision.submittedAt, elapsedSec: finalDecision.elapsedSec, payload: { ...finalDecision, sessionId: credentials.sessionId } }] }, queuedAt: new Date().toISOString(), attempts: 0 })
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

  const flush = useCallback((force = false) => getOutbox().flush(credentialsRef.current?.sessionId, force), [])
  const complete = useCallback(async (payload: {
    finalCandidateId: string
    finalConfidence: number
    submissionType: 'manual' | 'timeout_confirmed' | 'timeout_auto'
    finalPayload: unknown
  }) => {
    const credentials = credentialsRef.current
    if (!credentials) throw new Error('formal session not active')
    const eventId = `complete-${credentials.sessionId}`
    completionQueuedRef.current = true
    await getOutbox().enqueue({
      eventId,
      sessionId: credentials.sessionId,
      kind: 'complete',
      payload,
      queuedAt: new Date(Date.now() + 1).toISOString(),
      attempts: 0,
    })
    await getOutbox().flush(credentials.sessionId, true)
    const pending = await getStore().listOutbox(credentials.sessionId)
    const confirmed = !pending.some((item) => item.eventId === eventId)
    if (confirmed) {
      clearRecoveryPointer()
      await getStore().deleteSnapshot(credentials.sessionId)
      setStatus('completed')
      completionQueuedRef.current = false
    }
    return confirmed
  }, [])
  const clear = useCallback(async () => {
    const id = credentialsRef.current?.sessionId
    if (id) await getStore().deleteSnapshot(id)
    clearRecoveryPointer(); credentialsRef.current = null; setStatus('idle')
  }, [])

  const abandon = useCallback(async () => {
    const credentials = credentialsRef.current
    if (!credentials) return
    const eventId = `abandon-${credentials.sessionId}`
    await getOutbox().enqueue({
      eventId,
      sessionId: credentials.sessionId,
      kind: 'abandon',
      payload: { occurredAt: new Date().toISOString() },
      queuedAt: new Date().toISOString(),
      attempts: 0,
    })
    await getOutbox().flush(credentials.sessionId, true)
    const pending = await getStore().listOutbox(credentials.sessionId)
    if (!pending.some((item) => item.eventId === eventId)) {
      clearRecoveryPointer()
      await getStore().deleteSnapshot(credentials.sessionId)
      credentialsRef.current = null
      setStatus('idle')
    } else {
      setError('退出状态已保存在本设备，联网后会继续上报。')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    const online = () => {
      void flush(true).then(async () => {
        const credentials = credentialsRef.current
        if (!credentials || !completionQueuedRef.current) return
        const pending = await getStore().listOutbox(credentials.sessionId)
        if (pending.some((item) => item.kind === 'complete')) return
        completionQueuedRef.current = false
        clearRecoveryPointer()
        await getStore().deleteSnapshot(credentials.sessionId)
        setStatus('completed')
      })
    }
    const heartbeat = async () => {
      const credentials = credentialsRef.current
      if (!credentials) return
      const pendingEventCount = (await getStore().listOutbox(credentials.sessionId)).length
      void enqueue('heartbeat', {
        occurredAt: new Date().toISOString(),
        visible: document.visibilityState === 'visible',
        pendingEventCount,
        ...heartbeatStateRef.current,
      }, `heartbeat-${Date.now()}`)
    }
    const timer = window.setInterval(heartbeat, 30_000)
    const pagehide = () => { void heartbeat() }
    window.addEventListener('online', online)
    window.addEventListener('pagehide', pagehide)
    const visibility = () => { void heartbeat() }
    document.addEventListener('visibilitychange', visibility)
    return () => { window.clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility) }
  }, [enqueue, flush])

  return { status, error, credentials: credentialsRef.current, create, restore, persist, enqueue, flush, complete, abandon, clear }
}
