import { candidateById, candidates } from '../data/candidates'
import type {
  CandidateRuntimeState,
  GameLog,
  GameMode,
  GameState,
  NikoMessage,
  PressureStage,
  RatingStage,
  SunkCostChoice,
  VerifyType,
} from '../types/game'
import {
  FORMAL_DURATION_SEC,
  getPressureStage,
  getSunkCostThreshold,
  QUICK_DURATION_SEC,
} from '../utils/time'

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
    }
  | {
      type: 'VERIFY'
      candidateId: string
      verifyType: VerifyType
    }
  | { type: 'TICK'; deltaSec: number }
  | { type: 'SUNK_COST_CHOICE'; choice: Exclude<SunkCostChoice, null> }
  | { type: 'OPEN_DECISION' }
  | { type: 'RESUME_PLAYING' }
  | { type: 'FINAL_SELECT'; candidateId: string; nowMs: number }
  | { type: 'DISMISS_NOTICE' }
  | { type: 'NIKO_FEEDBACK'; message: NikoMessage }

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
  negativeEvidenceSeen: false,
  addedAfterNegative: false,
  viewTimeMs: 0,
})

export function createInitialGameState(
  mode: GameMode,
  nowMs = Date.now(),
): GameState {
  const durationSec =
    mode === 'quick' ? QUICK_DURATION_SEC : FORMAL_DURATION_SEC

  return {
    phase: 'playing',
    mode,
    durationSec,
    timeLeftSec: durationSec,
    elapsedSec: 0,
    availablePoints: 5,
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
  }
}

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

    return {
      ...state,
      runtime: {
        ...state.runtime,
        [action.candidateId]: nextRuntime,
      },
      logs: [...state.logs, log],
      lastActionElapsedSec: state.elapsedSec,
      notice: `${action.stage} 评分已封存；后续重评不会显示这次分数。`,
    }
  }

  if (action.type === 'VERIFY') {
    const runtime = state.runtime[action.candidateId]
    const candidate = candidateById[action.candidateId]
    if (!runtime || !candidate) return state

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

    const evidence =
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
      negativeEvidenceSeen:
        runtime.negativeEvidenceSeen || evidence.isNegative,
      addedAfterNegative:
        runtime.addedAfterNegative || addedAfterNegative,
    }
    const log = makeLog(state, {
      type: 'verify',
      verifyType: action.verifyType,
      candidateId: action.candidateId,
      detail: `${
        action.verifyType === 'shallow' ? '浅度' : '深度'
      }查证：${evidence.title}`,
      pointsSpent: cost,
      negativeEvidenceSeen: nextRuntime.negativeEvidenceSeen,
      addedAfterNegative,
    })
    const warningChat =
      addedAfterNegative && candidate.isToxic
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

    return {
      ...state,
      availablePoints: state.availablePoints - cost,
      runtime: {
        ...state.runtime,
        [action.candidateId]: nextRuntime,
      },
      logs: [...state.logs, log],
      chats: warningChat
        ? [...state.chats, warningChat]
        : state.chats,
      lastActionElapsedSec: state.elapsedSec,
      notice: `已消耗 ${cost} 点，解锁“${evidence.title}”。`,
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

    return {
      ...state,
      sunkCostChoice: action.choice,
      sunkCostShown: true,
      logs: [...state.logs, log],
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

    return {
      ...settled,
      phase: 'report',
      finalCandidateId: action.candidateId,
      logs: [...settled.logs, log],
      lastActionElapsedSec: settled.elapsedSec,
      notice: null,
    }
  }

  return state
}
