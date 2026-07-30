import { candidateById, candidates } from '../data/candidates'
import type {
  CandidateRuntimeState,
  GameLog,
  GameMode,
  GameState,
  NikoMessage,
  RatingEvent,
  EvidenceEvent,
  FinalDecision,
  PersistedStage,
  StageSnapshot,
  SubmissionType,
  SunkCostEvent,
  PressureStage,
  RatingStage,
  ResearchData,
  SunkCostChoice,
  VerifyType,
} from '../types/game'
import {
  FORMAL_DURATION_SEC,
  getPressureStage,
  getSunkCostThreshold,
  QUICK_DURATION_SEC,
} from '../utils/time'
import { shuffleCandidateIds } from '../utils/candidateOrder'

export type GameAction =
  | {
      type: 'SELECT_CANDIDATE'
      candidateId: string
      nowMs: number
    }
  | {
      type: 'RATE'
      candidateId: string
      stage: RatingStage
      value: number
      eventId?: string
      occurredAt?: string
    }
  | {
      type: 'VERIFY'
      candidateId: string
      verifyType: VerifyType
      eventId?: string
      occurredAt?: string
    }
  | { type: 'TICK'; deltaSec: number }
  | { type: 'SUNK_COST_CHOICE'; choice: Exclude<SunkCostChoice, null>; eventId?: string; occurredAt?: string }
  | { type: 'CAPTURE_STAGE_SNAPSHOT'; stage: PersistedStage; preferredCandidateId: string; confidence: number; eventId?: string; occurredAt?: string }
  | { type: 'OPEN_DECISION' }
  | { type: 'RESUME_PLAYING' }
  | { type: 'FINAL_SELECT'; candidateId: string; confidence: number; submissionType: SubmissionType; nowMs: number; eventId?: string; occurredAt?: string }
  | { type: 'DISMISS_NOTICE' }
  | { type: 'NIKO_FEEDBACK'; message: NikoMessage }
  | { type: 'TECHNICAL_ERROR'; reason: string; occurredAt?: string }
  | { type: 'TECHNICAL_RESUME'; occurredAt?: string }

const createRuntimeState = (
  candidateId: string,
): CandidateRuntimeState => ({
  candidateId,
  ratings: {},
  spentPoints: 0,
  shallowCount: 0,
  deepCount: 0,
  shallowUnlocked: false,
  deepUnlocked: false,
  viewedEvidenceIds: [],
  negativeEvidenceSeen: false,
  addedAfterNegative: false,
  viewTimeMs: 0,
})

export function createInitialGameState(
  mode: GameMode,
  nowMs = Date.now(),
  researchData: ResearchData | null = null,
): GameState {
  const durationSec =
    mode === 'quick' ? QUICK_DURATION_SEC : FORMAL_DURATION_SEC
  const candidateDisplayOrder = shuffleCandidateIds(
    candidates.map((candidate) => candidate.id),
  )

  return {
    phase: 'playing',
    mode,
    durationSec,
    timeLeftSec: durationSec,
    elapsedSec: 0,
    availablePoints: 5,
    candidateDisplayOrder,
    selectedCandidateId: candidates[0].id,
    runtime: Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        createRuntimeState(candidate.id),
      ]),
    ),
    logs: [],
    chats: [],
    nikoMessages: [],
    sunkCostChoice: null,
    sunkCostShown: false,
    finalCandidateId: null,
    activeViewStartedAtMs: nowMs,
    lastActionElapsedSec: 0,
    notice: null,
    participantId: researchData?.participantId ?? null,
    researchData,
    sessionId: `local-${nowMs}`,
    stageSnapshots: [],
    ratingEvents: [],
    evidenceEvents: [],
    sunkCostEvents: [],
    finalDecision: null,
    pendingSnapshotStage: null,
    invalidForAssessment: false,
    invalidReason: null,
    technicalPauseStartedAt: null,
    technicalPauseMs: 0,
  }
}

const updateLatestSunkCost = (
  events: SunkCostEvent[],
  updater: (event: SunkCostEvent) => SunkCostEvent,
) => events.map((event, index) => index === events.length - 1 ? updater(event) : event)

const clampRating = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)))

const stageFor = (state: GameState): PressureStage =>
  getPressureStage(state.elapsedSec, state.durationSec)

const makeLog = (
  state: GameState,
  data: Omit<
    GameLog,
    | 'id'
    | 'timeLeftSec'
    | 'elapsedSec'
    | 'pressureStage'
    | 'responseTimeSec'
  >,
): GameLog => ({
  id: `log-${state.logs.length + 1}`,
  timeLeftSec: state.timeLeftSec,
  elapsedSec: state.elapsedSec,
  pressureStage: stageFor(state),
  responseTimeSec: Math.max(
    0,
    state.elapsedSec - state.lastActionElapsedSec,
  ),
  ...data,
})

const settleViewTime = (state: GameState, nowMs: number): GameState => {
  const delta = Math.max(0, nowMs - state.activeViewStartedAtMs)
  const id = state.selectedCandidateId

  return {
    ...state,
    activeViewStartedAtMs: nowMs,
    runtime: {
      ...state.runtime,
      [id]: {
        ...state.runtime[id],
        viewTimeMs: state.runtime[id].viewTimeMs + delta,
      },
    },
  }
}

export const allT1Rated = (state: GameState): boolean =>
  candidates.every(
    (candidate) => state.runtime[candidate.id].ratings.T1 !== undefined,
  )

export function gameReducer(
  state: GameState,
  action: GameAction,
): GameState {
  if (action.type === 'TECHNICAL_ERROR') {
    return {
      ...state,
      invalidForAssessment: true,
      invalidReason: action.reason,
      technicalPauseStartedAt:
        state.technicalPauseStartedAt ?? action.occurredAt ?? new Date().toISOString(),
    }
  }

  if (action.type === 'TECHNICAL_RESUME') {
    if (!state.technicalPauseStartedAt) return state
    const endedAt = action.occurredAt ?? new Date().toISOString()
    const pauseMs = Math.max(
      0,
      Date.parse(endedAt) - Date.parse(state.technicalPauseStartedAt),
    )
    return {
      ...state,
      technicalPauseStartedAt: null,
      technicalPauseMs: state.technicalPauseMs + pauseMs,
      activeViewStartedAtMs: Date.now(),
    }
  }

  if (action.type === 'CAPTURE_STAGE_SNAPSHOT') {
    if (!candidateById[action.preferredCandidateId]) return state
    const snapshot: StageSnapshot = {
      eventId: action.eventId ?? `snapshot-${state.sessionId}-${action.stage}`,
      sessionId: state.sessionId,
      stage: action.stage,
      preferredCandidateId: action.preferredCandidateId,
      confidence: clampRating(action.confidence),
      submittedAt: action.occurredAt ?? new Date().toISOString(),
    }
    return {
      ...state,
      stageSnapshots: [...state.stageSnapshots.filter((item) => item.stage !== action.stage), snapshot],
      pendingSnapshotStage: null,
      phase: action.stage === 'T2' || action.stage === 'T3' ? 'decision' : state.phase,
    }
  }

  if (action.type === 'NIKO_FEEDBACK') {
    const existingIndex = state.nikoMessages.findIndex(
      (message) => message.id === action.message.id,
    )
    const nikoMessages = [...state.nikoMessages]

    if (existingIndex === -1) {
      nikoMessages.push(action.message)
    } else {
      nikoMessages[existingIndex] = action.message
    }

    return { ...state, nikoMessages }
  }

  if (action.type === 'DISMISS_NOTICE') {
    return { ...state, notice: null }
  }

  if (action.type === 'TICK') {
    const elapsedSec = Math.min(
      state.durationSec,
      state.elapsedSec + Math.max(0, action.deltaSec),
    )
    const timeLeftSec = Math.max(0, state.durationSec - elapsedSec)
    const hasToxicInvestment = candidates.some(
      (candidate) =>
        candidate.isToxic &&
        state.runtime[candidate.id].spentPoints >= 2,
    )
    const shouldShowSunkCost =
      !state.sunkCostShown &&
      state.sunkCostChoice === null &&
      hasToxicInvestment &&
      timeLeftSec <= getSunkCostThreshold(state.durationSec)

    return {
      ...state,
      elapsedSec,
      timeLeftSec,
      sunkCostShown: state.sunkCostShown || shouldShowSunkCost,
      phase: timeLeftSec === 0 ? 'decision' : state.phase,
    }
  }

  if (action.type === 'SELECT_CANDIDATE') {
    if (!state.runtime[action.candidateId]) return state
    if (action.candidateId === state.selectedCandidateId) return state

    const settled = settleViewTime(state, action.nowMs)
    const log = makeLog(settled, {
      type: 'view',
      candidateId: action.candidateId,
      detail: `切换查看候选人 ${action.candidateId}`,
    })

    return {
      ...settled,
      selectedCandidateId: action.candidateId,
      sunkCostEvents: updateLatestSunkCost(settled.sunkCostEvents, (event) => ({ ...event, subsequentCandidateSwitches: event.subsequentCandidateSwitches + 1 })),
      logs: [...settled.logs, log],
      lastActionElapsedSec: settled.elapsedSec,
      notice: null,
    }
  }

  if (action.type === 'RATE') {
    const runtime = state.runtime[action.candidateId]
    if (!runtime) return state

    if (
      (action.stage === 'T2' && !runtime.shallowUnlocked) ||
      (action.stage === 'T3' && !runtime.deepUnlocked)
    ) {
      return {
        ...state,
        notice:
          action.stage === 'T2'
            ? '完成浅度查证后才能提交 T2 评分。'
            : '完成深度查证后才能提交 T3 评分。',
      }
    }

    const value = clampRating(action.value)
    const nextRuntime = {
      ...runtime,
      ratings: {
        ...runtime.ratings,
        [action.stage]: { value, elapsedSec: state.elapsedSec },
      },
    }
    const log = makeLog(state, {
      type: 'rate',
      candidateId: action.candidateId,
      detail: `提交 ${action.stage} 评分：${value}`,
    })
    const ratingEvent: RatingEvent = {
      eventId: action.eventId ?? `rate-${state.sessionId}-${state.ratingEvents.length + 1}`,
      sessionId: state.sessionId,
      candidateId: action.candidateId,
      stage: action.stage,
      score: value,
      relatedEvidenceIds: [...runtime.viewedEvidenceIds],
      submittedAt: action.occurredAt ?? new Date().toISOString(),
      elapsedSec: state.elapsedSec,
    }

    return {
      ...state,
      runtime: {
        ...state.runtime,
        [action.candidateId]: nextRuntime,
      },
      logs: [...state.logs, log],
      ratingEvents: [...state.ratingEvents, ratingEvent],
      sunkCostEvents: updateLatestSunkCost(state.sunkCostEvents, (event) => ({ ...event, subsequentRatingChanges: event.subsequentRatingChanges + 1 })),
      lastActionElapsedSec: state.elapsedSec,
      notice: `${action.stage} 评分已封存；后续重评不会显示这次分数。`,
    }
  }

  if (action.type === 'VERIFY') {
    const runtime = state.runtime[action.candidateId]
    const candidate = candidateById[action.candidateId]
    if (!runtime || !candidate) return state
    if (
      action.eventId &&
      state.evidenceEvents.some((event) => event.eventId === action.eventId)
    ) {
      return state
    }

    const cost = action.verifyType === 'shallow' ? 1 : 3
    const alreadyUnlocked =
      action.verifyType === 'shallow'
        ? runtime.shallowUnlocked
        : runtime.deepUnlocked

    if (alreadyUnlocked) {
      return {
        ...state,
        notice: '该证据已经解锁，不会重复扣除点数。',
      }
    }

    if (state.availablePoints < cost) {
      return {
        ...state,
        notice: `查证点数不足：${
          action.verifyType === 'deep' ? '深度' : '浅度'
        }查证需要 ${cost} 点。`,
      }
    }

    const evidenceBundle =
      action.verifyType === 'shallow'
        ? candidate.shallowEvidence
        : candidate.deepEvidence
    const addedAfterNegative = runtime.negativeEvidenceSeen
    const nextRuntime: CandidateRuntimeState = {
      ...runtime,
      spentPoints: runtime.spentPoints + cost,
      shallowCount:
        runtime.shallowCount + (action.verifyType === 'shallow' ? 1 : 0),
      deepCount:
        runtime.deepCount + (action.verifyType === 'deep' ? 1 : 0),
      shallowUnlocked:
        runtime.shallowUnlocked || action.verifyType === 'shallow',
      deepUnlocked:
        runtime.deepUnlocked || action.verifyType === 'deep',
      viewedEvidenceIds: [
        ...runtime.viewedEvidenceIds,
        ...evidenceBundle
          .map((evidence) => evidence.id)
          .filter((id) => !runtime.viewedEvidenceIds.includes(id)),
      ],
      negativeEvidenceSeen:
        runtime.negativeEvidenceSeen ||
        evidenceBundle.some((evidence) => evidence.isNegative),
      addedAfterNegative:
        runtime.addedAfterNegative || addedAfterNegative,
    }
    const log = makeLog(state, {
      type: 'verify',
      verifyType: action.verifyType,
      candidateId: action.candidateId,
      detail: `${
        action.verifyType === 'shallow' ? '浅度' : '深度'
      }查证：${evidenceBundle.map((evidence) => evidence.title).join('、')}`,
      pointsSpent: cost,
      negativeEvidenceSeen: nextRuntime.negativeEvidenceSeen,
      addedAfterNegative,
    })
    const warningChat =
      state.mode === 'quick' && addedAfterNegative && candidate.isToxic
        ? {
            id: `chat-${state.chats.length + 1}`,
            sender: (state.chats.length % 2 ? '李姐' : '小张') as
              | '李姐'
              | '小张',
            content: `候选人 ${candidate.name} 已出现不利证据，你还要继续投入。是在查证新假设，还是在维护最初判断？`,
            elapsedSec: state.elapsedSec,
            tone: 'warning' as const,
          }
        : null
    const pointsBefore = state.availablePoints
    const evidenceEvent: EvidenceEvent = {
      eventId:
        action.eventId ??
        `verify-${state.sessionId}-${state.evidenceEvents.length + 1}`,
      sessionId: state.sessionId,
      candidateId: action.candidateId,
      evidenceId: evidenceBundle[0]?.id ?? `${action.candidateId}-${action.verifyType}`,
      evidenceIds: evidenceBundle.map((evidence) => evidence.id),
      verifyType: action.verifyType,
      evidencePolarity: evidenceBundle.some((evidence) => evidence.isNegative)
        ? 'negative'
        : 'positive',
      viewedAt: action.occurredAt ?? new Date().toISOString(),
      elapsedSec: state.elapsedSec,
      pointsBefore,
      pointsCost: cost,
      pointsAfter: pointsBefore - cost,
      riskEvidenceSeenBefore: runtime.negativeEvidenceSeen,
      addedAfterRiskEvidence: addedAfterNegative && candidate.isToxic,
      cumulativeAddedAfterRiskEvidence:
        state.evidenceEvents
          .filter(
            (event) =>
              event.candidateId === action.candidateId &&
              event.addedAfterRiskEvidence,
          )
          .reduce((total, event) => total + event.pointsCost, 0) +
        (addedAfterNegative && candidate.isToxic ? cost : 0),
      additionalPointsThisEvent: addedAfterNegative ? cost : 0,
      cumulativeAdditionalPointsAfterRisk:
        state.evidenceEvents.filter((event) => event.candidateId === action.candidateId && event.addedAfterRiskEvidence).reduce((total, event) => total + event.pointsCost, 0) + (addedAfterNegative ? cost : 0),
      riskEvidenceIdsPreviouslySeen: runtime.viewedEvidenceIds.filter((id) =>
        [...candidate.shallowEvidence, ...candidate.deepEvidence].some((evidence) => evidence.id === id && evidence.polarity === 'negative'),
      ),
    }

    return {
      ...state,
      availablePoints: state.availablePoints - cost,
      runtime: {
        ...state.runtime,
        [action.candidateId]: nextRuntime,
      },
      logs: [...state.logs, log],
      evidenceEvents: [...state.evidenceEvents, evidenceEvent],
      sunkCostEvents: updateLatestSunkCost(state.sunkCostEvents, (event) => ({ ...event, subsequentAdditionalPoints: event.subsequentAdditionalPoints + cost })),
      chats: warningChat
        ? [...state.chats, warningChat]
        : state.chats,
      lastActionElapsedSec: state.elapsedSec,
      notice: `已消耗 ${cost} 点，解锁 ${evidenceBundle.length} 份${
        action.verifyType === 'shallow' ? 'T2 浅度' : 'T3 深度'
      }材料。`,
    }
  }

  if (action.type === 'SUNK_COST_CHOICE') {
    const labels = {
      continue: '追加验证',
      stop_loss: '立即止损',
      give_up: '放弃本轮补录',
    }
    const log = makeLog(state, {
      type: 'sunk_cost',
      detail: `沉没成本选择：${labels[action.choice]}`,
    })
    const latest = state.stageSnapshots.at(-1)
    const toxic = candidates.filter((candidate) => candidate.isToxic).sort((a, b) => state.runtime[b.id].spentPoints - state.runtime[a.id].spentPoints)[0]
    const sunkEvent: SunkCostEvent = {
      eventId: action.eventId ?? `sunk-${state.sessionId}-${state.sunkCostEvents.length + 1}`, sessionId: state.sessionId,
      choice: action.choice, selectedAt: action.occurredAt ?? new Date().toISOString(), elapsedSec: state.elapsedSec,
      pointsSpentBeforeChoice: 5 - state.availablePoints, availablePointsBeforeChoice: state.availablePoints,
      preferredCandidateIdAtChoice: latest?.preferredCandidateId ?? state.selectedCandidateId, confidenceAtChoice: latest?.confidence ?? null,
      toxicCandidateId: toxic?.id ?? null, toxicCandidatePoints: toxic ? state.runtime[toxic.id].spentPoints : 0,
      subsequentAdditionalPoints: 0, subsequentCandidateSwitches: 0, subsequentRatingChanges: 0,
      finalCandidateId: null, finalConfidence: null, secondsFromChoiceToFinal: null,
    }

    return {
      ...state,
      sunkCostChoice: action.choice,
      sunkCostShown: true,
      logs: [...state.logs, log],
      sunkCostEvents: [...state.sunkCostEvents, sunkEvent],
      lastActionElapsedSec: state.elapsedSec,
      phase: action.choice === 'give_up' ? 'decision' : state.phase,
      notice:
        action.choice === 'continue'
          ? '你选择继续承担验证成本；剩余点数不会额外增加。'
          : action.choice === 'stop_loss'
            ? '你已标记止损，继续比较其他候选人。'
            : '你选择停止补录，本轮仍可指定“保留意见”的最终结果。',
    }
  }

  if (action.type === 'OPEN_DECISION') {
    if (!allT1Rated(state)) {
      return {
        ...state,
        notice: '必须先完成 5 名候选人的 T1 初评。',
      }
    }

    if (state.mode === 'quick') return { ...state, phase: 'decision', notice: null }
    const requestedStage = state.evidenceEvents.some((event) => event.verifyType === 'deep') ? 'T3' : state.evidenceEvents.some((event) => event.verifyType === 'shallow') ? 'T2' : null
    if (requestedStage && !state.stageSnapshots.some((snapshot) => snapshot.stage === requestedStage)) return { ...state, pendingSnapshotStage: requestedStage, notice: null }
    return { ...state, phase: 'decision', notice: null }
  }

  if (action.type === 'RESUME_PLAYING') {
    return state.timeLeftSec > 0
      ? { ...state, phase: 'playing' }
      : state
  }

  if (action.type === 'FINAL_SELECT') {
    if (!candidateById[action.candidateId]) return state

    const settled = settleViewTime(state, action.nowMs)
    const log = makeLog(settled, {
      type: 'final_select',
      candidateId: action.candidateId,
      detail: `最终录用候选人 ${action.candidateId}`,
    })
    const confidence = clampRating(action.confidence)
    const submissionType = action.submissionType
    const finalDecision: FinalDecision = { eventId: action.eventId ?? `final-${state.sessionId}`, sessionId: state.sessionId, candidateId: action.candidateId, confidence, submissionType, submittedAt: action.occurredAt ?? new Date().toISOString(), elapsedSec: state.elapsedSec, currentStage: 'FINAL', timeoutSource: submissionType === 'manual' ? null : 'timer' }
    const finalSnapshot: StageSnapshot = { eventId: `${finalDecision.eventId}-snapshot`, sessionId: state.sessionId, stage: 'FINAL', preferredCandidateId: action.candidateId, confidence, submittedAt: finalDecision.submittedAt }

    return {
      ...settled,
      phase: 'report',
      finalCandidateId: action.candidateId,
      finalDecision,
      stageSnapshots: [...settled.stageSnapshots.filter((snapshot) => snapshot.stage !== 'FINAL'), finalSnapshot],
      sunkCostEvents: updateLatestSunkCost(settled.sunkCostEvents, (event) => ({ ...event, finalCandidateId: action.candidateId, finalConfidence: confidence, secondsFromChoiceToFinal: Math.max(0, settled.elapsedSec - event.elapsedSec) })),
      logs: [...settled.logs, log],
      lastActionElapsedSec: settled.elapsedSec,
      notice: null,
    }
  }

  return state
}
