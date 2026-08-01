import { useCallback, useEffect, useRef, useState } from 'react'
import {
  startFormalGame,
  submitFormalT1Rating,
  submitFormalT1StageChoice,
} from '../api/formalGame'
import type { FormalGameSnapshot, FormalGameStartResponse } from '../types/formalGame'
import type { FormalSessionContext, PublicCandidateId } from '../types/game'
import {
  clearFormalGamePendingKey,
  getOrCreateFormalGamePendingKey,
} from '../utils/formalPendingKeys'

const CLIENT_VERSION = import.meta.env.VITE_COMMIT_SHA ?? 'web-1.0.0'

function snapshotFromStart(result: FormalGameStartResponse): FormalGameSnapshot {
  return {
    started: true,
    resumeSupported: true,
    durationSec: 900,
    startedAt: result.startedAt,
    deadlineAt: result.deadlineAt,
    serverNow: result.serverNow,
    remainingSec: result.remainingSec,
    expired: result.expired,
    currentStage: result.currentStage,
    points: result.points,
    ratings: result.ratings,
    stageChoice: result.stageChoice,
  }
}

export function useFormalGameController({
  session,
  initialSnapshot,
  onSnapshot,
}: {
  session: FormalSessionContext
  initialSnapshot?: FormalGameSnapshot | null
  onSnapshot?: (snapshot: FormalGameSnapshot) => void
}) {
  const [snapshot, setSnapshot] = useState<FormalGameSnapshot | null>(initialSnapshot ?? null)
  const [remainingSec, setRemainingSec] = useState(initialSnapshot?.remainingSec ?? 900)
  const [startError, setStartError] = useState<string | null>(null)
  const [ratingError, setRatingError] = useState<Record<string, string | null>>({})
  const [choiceError, setChoiceError] = useState<string | null>(null)
  const [pendingRatingId, setPendingRatingId] = useState<PublicCandidateId | null>(null)
  const [choicePending, setChoicePending] = useState(false)
  const startAttempted = useRef(false)
  const onSnapshotRef = useRef(onSnapshot)

  useEffect(() => { onSnapshotRef.current = onSnapshot }, [onSnapshot])
  useEffect(() => {
    if (!snapshot && initialSnapshot) {
      setSnapshot(initialSnapshot)
      setRemainingSec(initialSnapshot.remainingSec)
    }
  }, [initialSnapshot, snapshot])
  useEffect(() => {
    if (snapshot) onSnapshotRef.current?.(snapshot)
  }, [snapshot])

  const start = useCallback(async () => {
    setStartError(null)
    const key = getOrCreateFormalGamePendingKey('game-start')
    try {
      const result = await startFormalGame({
        sessionId: session.sessionId,
        clientStartedAt: new Date().toISOString(),
        clientVersion: CLIENT_VERSION,
      }, key)
      clearFormalGamePendingKey('game-start')
      const next = snapshotFromStart(result)
      setSnapshot(next)
      setRemainingSec(next.remainingSec)
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '\u6682\u65f6\u65e0\u6cd5\u542f\u52a8\u6b63\u5f0f\u6d4b\u8bc4\u3002')
    }
  }, [session.sessionId])

  useEffect(() => {
    if (session.currentStep !== 'game_ready' || snapshot || startAttempted.current) return
    startAttempted.current = true
    void start()
  }, [session.currentStep, snapshot, start])

  useEffect(() => {
    if (!snapshot) return
    const localDeadline = Date.now() + snapshot.remainingSec * 1000
    setRemainingSec(snapshot.remainingSec)
    const timer = window.setInterval(() => {
      setRemainingSec(Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000)))
    }, 250)
    return () => window.clearInterval(timer)
  }, [snapshot?.deadlineAt, snapshot?.serverNow])

  const retryStart = useCallback(() => {
    startAttempted.current = true
    void start()
  }, [start])

  const submitRating = useCallback(async (candidateId: PublicCandidateId, ratingValue: number) => {
    if (!snapshot || remainingSec === 0 || snapshot.currentStage !== 'T1') return
    setPendingRatingId(candidateId)
    setRatingError((current) => ({ ...current, [candidateId]: null }))
    const key = getOrCreateFormalGamePendingKey(`rating:T1:${candidateId}`)
    try {
      const result = await submitFormalT1Rating({
        sessionId: session.sessionId,
        candidateId,
        ratingValue,
        clientSubmittedAt: new Date().toISOString(),
        clientSequence: snapshot.lastSequenceNo ?? snapshot.ratings.length + 1,
      }, key)
      clearFormalGamePendingKey(`rating:T1:${candidateId}`)
      setSnapshot((current) => current ? {
        ...current,
        ratings: [
          ...current.ratings.filter((rating) => rating.candidateId !== result.candidateId),
          {
            candidateId: result.candidateId,
            stage: 'T1' as const,
            ratingValue: result.ratingValue,
            sealed: true as const,
            sequenceNo: result.sequenceNo,
            serverSubmittedAt: result.serverSubmittedAt,
          },
        ].sort((left, right) => left.sequenceNo - right.sequenceNo),
        lastSequenceNo: result.sequenceNo,
      } : current)
    } catch (error) {
      setRatingError((current) => ({
        ...current,
        [candidateId]: error instanceof Error ? error.message : '\u8bc4\u5206\u6682\u65f6\u65e0\u6cd5\u4fdd\u5b58\uff0c\u8bf7\u91cd\u8bd5\u3002',
      }))
    } finally {
      setPendingRatingId(null)
    }
  }, [remainingSec, session.sessionId, snapshot])

  const submitChoice = useCallback(async (candidateId: PublicCandidateId, confidence: number) => {
    if (!snapshot || remainingSec === 0 || snapshot.ratings.length !== 5) return
    setChoicePending(true)
    setChoiceError(null)
    const key = getOrCreateFormalGamePendingKey('stage-choice:T1')
    try {
      const result = await submitFormalT1StageChoice({
        sessionId: session.sessionId,
        candidateId,
        confidence,
        clientSubmittedAt: new Date().toISOString(),
        clientSequence: snapshot.lastSequenceNo ?? 6,
      }, key)
      clearFormalGamePendingKey('stage-choice:T1')
      setSnapshot((current) => current ? {
        ...current,
        currentStage: 'T1_COMPLETE',
        stageChoice: {
          stage: 'T1', candidateId: result.candidateId,
          confidence: result.confidence, sealed: true,
          sequenceNo: result.sequenceNo,
          serverSubmittedAt: result.serverSubmittedAt,
        },
        lastSequenceNo: result.sequenceNo,
      } : current)
    } catch (error) {
      setChoiceError(error instanceof Error ? error.message : '\u9636\u6bb5\u5224\u65ad\u6682\u65f6\u65e0\u6cd5\u4fdd\u5b58\uff0c\u8bf7\u91cd\u8bd5\u3002')
    } finally {
      setChoicePending(false)
    }
  }, [remainingSec, session.sessionId, snapshot])

  return {
    snapshot,
    remainingSec,
    expired: snapshot?.expired === true || remainingSec === 0,
    startError,
    ratingError,
    pendingRatingId,
    choiceError,
    choicePending,
    retryStart,
    submitRating,
    submitChoice,
  }
}
