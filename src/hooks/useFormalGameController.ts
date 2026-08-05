import { useCallback, useEffect, useRef, useState } from 'react'
import { unlockFormalEvidence } from '../api/formalEvidence'
import {
  startFormalGame,
  submitFormalRating,
  submitFormalStageChoice,
  checkFormalSunkCost,
  submitFormalSunkCostChoice,
  submitActiveFinalDecision,
  submitTimeoutFinalDecision,
} from '../api/formalGame'
import type {
  FormalEvidenceLevel,
  FormalEvidenceUnlockResponse,
  FormalGameSnapshot,
  FormalGameStartResponse,
  FormalRatingResponse,
  FormalRatingStage,
  FormalFinalDecision,
  FormalSunkCostSnapshot,
} from '../types/formalGame'
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
    stageStatus: result.stageStatus,
    points: result.points,
    ratings: result.ratings,
    stageChoice: result.stageChoice,
    stageChoices: result.stageChoices,
    finalDecisionAvailability: result.finalDecisionAvailability,
    evidenceUnlocks: result.evidenceUnlocks,
    sunkCost: null,
    finalDecision: null,
  }
}

const operationErrorKey = (
  stageOrLevel: FormalRatingStage | FormalEvidenceLevel,
  candidateId: PublicCandidateId,
) => `${stageOrLevel}:${candidateId}`

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
  const [operationErrors, setOperationErrors] = useState<Record<string, string | null>>({})
  const [choiceError, setChoiceError] = useState<string | null>(null)
  const [pendingRating, setPendingRating] = useState<string | null>(null)
  const [pendingEvidence, setPendingEvidence] = useState<string | null>(null)
  const [choicePending, setChoicePending] = useState(false)
  const [sunkCost, setSunkCost] = useState<FormalSunkCostSnapshot | null>(initialSnapshot?.sunkCost ?? null)
  const [finalDecision, setFinalDecision] = useState<FormalFinalDecision | null>(initialSnapshot?.finalDecision ?? null)
  const [stage6Pending, setStage6Pending] = useState<'show' | 'choice' | 'final' | 'timeout' | null>(null)
  const [stage6Error, setStage6Error] = useState<string | null>(null)
  const lastSunkCheck = useRef<string | null>(null)
  const timeoutStarted = useRef(false)
  const startAttempted = useRef(false)
  const onSnapshotRef = useRef(onSnapshot)

  useEffect(() => { onSnapshotRef.current = onSnapshot }, [onSnapshot])
  useEffect(() => {
    if (!snapshot && initialSnapshot) {
      setSnapshot(initialSnapshot)
      setRemainingSec(initialSnapshot.remainingSec)
      setSunkCost(initialSnapshot.sunkCost ?? null)
      setFinalDecision(initialSnapshot.finalDecision ?? null)
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
      setStartError(error instanceof Error ? error.message : '暂时无法启动正式测评。')
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

  const submitRating = useCallback(async (
    candidateId: PublicCandidateId,
    stage: FormalRatingStage,
    ratingValue: number,
  ): Promise<FormalRatingResponse | null> => {
    if (!snapshot || remainingSec === 0) return null
    const operation = operationErrorKey(stage, candidateId)
    setPendingRating(operation)
    setOperationErrors((current) => ({ ...current, [operation]: null }))
    const pendingOperation = `rating:${stage}:${candidateId}` as const
    const key = getOrCreateFormalGamePendingKey(pendingOperation)
    try {
      const result = await submitFormalRating({
        sessionId: session.sessionId,
        candidateId,
        stage,
        ratingValue,
        clientSubmittedAt: new Date().toISOString(),
        clientSequence: snapshot.lastSequenceNo ?? 1,
      }, key)
      clearFormalGamePendingKey(pendingOperation)
      setSnapshot((current) => current ? {
        ...current,
        ratings: [
          ...current.ratings.filter((rating) =>
            !(rating.candidateId === result.candidateId && rating.stage === result.stage)),
          {
            candidateId: result.candidateId,
            stage: result.stage,
            ratingValue: result.ratingValue,
            evidenceIdsSeen: result.evidenceIdsSeen,
            sealed: true as const,
            sequenceNo: result.sequenceNo,
            serverSubmittedAt: result.serverSubmittedAt,
          },
        ].sort((left, right) => left.sequenceNo - right.sequenceNo),
        finalDecisionAvailability: result.finalDecisionAvailability ?? current.finalDecisionAvailability,
        lastSequenceNo: result.sequenceNo,
      } : current)
      return result
    } catch (error) {
      setOperationErrors((current) => ({
        ...current,
        [operation]: error instanceof Error ? error.message : '评分暂时无法保存，请重试。',
      }))
      return null
    } finally {
      setPendingRating(null)
    }
  }, [remainingSec, session.sessionId, snapshot])

  const submitChoice = useCallback(async (
    stage: FormalRatingStage,
    candidateId: PublicCandidateId,
    confidence: number,
  ) => {
    if (!snapshot || remainingSec === 0) return null
    setChoicePending(true)
    setChoiceError(null)
    const pendingOperation = `stage-choice:${stage}` as const
    const key = getOrCreateFormalGamePendingKey(pendingOperation)
    try {
      const result = await submitFormalStageChoice({
        sessionId: session.sessionId,
        stage,
        candidateId,
        confidence,
        clientSubmittedAt: new Date().toISOString(),
        clientSequence: snapshot.lastSequenceNo ?? 1,
      }, key)
      clearFormalGamePendingKey(pendingOperation)
      setSnapshot((current) => current ? {
        ...current,
        currentStage: result.currentStage,
        stageStatus: result.stageStatus,
        stageChoice: result.stage === 'T1' ? {
          stage: 'T1', candidateId: result.candidateId,
          confidence: result.confidence, sealed: true as const,
          sequenceNo: result.sequenceNo,
          serverSubmittedAt: result.serverSubmittedAt,
        } : current.stageChoice,
        stageChoices: [
          ...current.stageChoices.filter((choice) => choice.stage !== result.stage),
          {
            stage: result.stage, candidateId: result.candidateId,
            confidence: result.confidence, sealed: true as const,
            sequenceNo: result.sequenceNo,
            serverSubmittedAt: result.serverSubmittedAt,
          },
        ].sort((left, right) => left.sequenceNo - right.sequenceNo),
        lastSequenceNo: result.sequenceNo,
      } : current)
      return result
    } catch (error) {
      setChoiceError(error instanceof Error ? error.message : '阶段判断暂时无法保存，请重试。')
      return null
    } finally {
      setChoicePending(false)
    }
  }, [remainingSec, session.sessionId, snapshot])

  const unlockEvidence = useCallback(async (
    candidateId: PublicCandidateId,
    level: FormalEvidenceLevel,
  ): Promise<FormalEvidenceUnlockResponse | null> => {
    if (!snapshot || remainingSec === 0) return null
    const operation = operationErrorKey(level, candidateId)
    setPendingEvidence(operation)
    setOperationErrors((current) => ({ ...current, [operation]: null }))
    const pendingOperation = `evidence:${level}:${candidateId}` as const
    const key = getOrCreateFormalGamePendingKey(pendingOperation)
    try {
      const result = await unlockFormalEvidence({
        sessionId: session.sessionId,
        candidateId,
        level,
        clientAt: new Date().toISOString(),
        clientSequence: snapshot.lastSequenceNo ?? 1,
      }, key)
      clearFormalGamePendingKey(pendingOperation)
      setSnapshot((current) => current ? {
        ...current,
        currentStage: result.currentStage,
        stageStatus: result.stageStatus,
        points: { total: result.points.total, remaining: result.points.after },
        evidenceUnlocks: [
          ...current.evidenceUnlocks.filter((unlock) =>
            !(unlock.candidateId === result.candidateId && unlock.level === result.level)),
          {
            candidateId: result.candidateId,
            level: result.level,
            ratingStage: result.ratingStage,
            sequenceNo: result.sequenceNo,
            serverAt: result.serverAt,
            points: {
              before: result.points.before,
              cost: result.points.cost,
              after: result.points.after,
            },
            evidence: result.evidence,
          },
        ].sort((left, right) => left.sequenceNo - right.sequenceNo),
        lastSequenceNo: Math.max(current.lastSequenceNo ?? 0, result.sequenceNo),
      } : current)
      return result
    } catch (error) {
      setOperationErrors((current) => ({
        ...current,
        [operation]: error instanceof Error ? error.message : '查证暂时无法完成，请重试。',
      }))
      return null
    } finally {
      setPendingEvidence(null)
    }
  }, [remainingSec, session.sessionId, snapshot])

  const checkSunkCost = useCallback(async () => {
    if (!snapshot || remainingSec <= 0 || remainingSec > 300 || sunkCost || finalDecision) return null
    const signature = `${snapshot.lastSequenceNo ?? 0}:${remainingSec <= 300}`
    if (lastSunkCheck.current === signature) return null
    lastSunkCheck.current = signature
    setStage6Pending('show')
    setStage6Error(null)
    const key = getOrCreateFormalGamePendingKey('sunk-cost-show')
    try {
      const result = await checkFormalSunkCost({
        sessionId: session.sessionId,
        clientShownAt: new Date().toISOString(),
        clientSequence: snapshot.lastSequenceNo ?? 1,
      }, key)
      if (result.triggered) {
        clearFormalGamePendingKey('sunk-cost-show')
        setSunkCost(result)
        setSnapshot((current) => current ? { ...current, sunkCost: result } : current)
      }
      return result
    } catch (error) {
      lastSunkCheck.current = null
      setStage6Error(error instanceof Error ? error.message : '暂时无法确认决策检查点，请重试。')
      return null
    } finally {
      setStage6Pending(null)
    }
  }, [finalDecision, remainingSec, session.sessionId, snapshot, sunkCost])

  useEffect(() => { void checkSunkCost() }, [checkSunkCost])

  const submitSunkChoice = useCallback(async (choice: 'continue' | 'stop_loss' | 'give_up') => {
    if (!snapshot || !sunkCost?.sunkEventId || !sunkCost.required) return null
    setStage6Pending('choice')
    setStage6Error(null)
    const key = getOrCreateFormalGamePendingKey('sunk-cost-choice')
    try {
      const result = await submitFormalSunkCostChoice({
        sessionId: session.sessionId, sunkEventId: sunkCost.sunkEventId, choice,
        clientSubmittedAt: new Date().toISOString(), clientSequence: snapshot.lastSequenceNo ?? 1,
      }, key)
      clearFormalGamePendingKey('sunk-cost-choice')
      setSunkCost(result)
      setSnapshot((current) => current ? {
        ...current,
        sunkCost: result,
        currentStage: choice === 'give_up' ? 'DECISION' : current.currentStage,
        stageStatus: choice === 'give_up' ? 'DECISION_COMPLETE' : current.stageStatus,
      } : current)
      return result
    } catch (error) {
      setStage6Error(error instanceof Error ? error.message : '决策检查点暂时无法保存，请重试。')
      return null
    } finally {
      setStage6Pending(null)
    }
  }, [session.sessionId, snapshot, sunkCost])

  const submitFinal = useCallback(async (candidateId: PublicCandidateId, confidence: number) => {
    if (!snapshot || finalDecision || remainingSec <= 0) return null
    setStage6Pending('final')
    setStage6Error(null)
    const key = getOrCreateFormalGamePendingKey('final-decision')
    try {
      const result = await submitActiveFinalDecision({
        sessionId: session.sessionId, candidateId, confidence,
        clientSubmittedAt: new Date().toISOString(), clientSequence: snapshot.lastSequenceNo ?? 1,
      }, key)
      clearFormalGamePendingKey('final-decision')
      setFinalDecision(result)
      setSnapshot((current) => current ? {
        ...current, currentStage: 'DECISION', stageStatus: 'DECISION_COMPLETE',
        finalDecision: result, lastSequenceNo: result.sequenceNo,
      } : current)
      return result
    } catch (error) {
      setStage6Error(error instanceof Error ? error.message : '最终录用结果暂时无法保存，请重试。')
      return null
    } finally {
      setStage6Pending(null)
    }
  }, [finalDecision, remainingSec, session.sessionId, snapshot])

  useEffect(() => {
    if (!snapshot || remainingSec !== 0 || finalDecision || timeoutStarted.current) return
    timeoutStarted.current = true
    let active = true
    const timeout = async () => {
      setStage6Pending('timeout')
      const key = getOrCreateFormalGamePendingKey('timeout-final-decision')
      try {
        const result = await submitTimeoutFinalDecision({
          sessionId: session.sessionId, clientObservedAt: new Date().toISOString(),
          clientSequence: snapshot.lastSequenceNo ?? 1,
        }, key)
        if (!active) return
        clearFormalGamePendingKey('timeout-final-decision')
        setFinalDecision(result)
        setSnapshot((current) => current ? { ...current, currentStage: 'DECISION',
          stageStatus: 'DECISION_COMPLETE', finalDecision: result,
          lastSequenceNo: result.sequenceNo } : current)
      } catch (error) {
        if (active) {
          timeoutStarted.current = false
          setStage6Error(error instanceof Error ? error.message : '超时结果暂时无法封存，请重试。')
        }
      } finally {
        if (active) setStage6Pending(null)
      }
    }
    void timeout()
    return () => { active = false }
  }, [finalDecision, remainingSec, session.sessionId, snapshot])

  return {
    snapshot,
    remainingSec,
    expired: snapshot?.expired === true || remainingSec === 0,
    startError,
    operationErrors,
    pendingRating,
    pendingEvidence,
    choiceError,
    choicePending,
    retryStart,
    submitRating,
    submitChoice,
    unlockEvidence,
    sunkCost,
    finalDecision,
    stage6Pending,
    stage6Error,
    checkSunkCost,
    submitSunkChoice,
    submitFinal,
  }
}
