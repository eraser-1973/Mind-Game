import { candidateById } from '../data/candidates'
import type {
  Candidate,
  GameLog,
  RDIInput,
  RDIResult,
  RatingRecord,
  RatingStage,
  RevisionResult,
  ROIResult,
  StrategyType,
  SunkCostChoice,
} from '../types/game'

export function calculateROI(
  selectedCandidate: Candidate,
  spentPoints: number,
): ROIResult {
  if (spentPoints <= 0) {
    return {
      value: selectedCandidate.trueAbility,
      note: '未查证直接录用',
      unverifiedHire: true,
    }
  }
  return {
    value: selectedCandidate.trueAbility / spentPoints,
    note: '真实能力值 ÷ 对该候选人的查证点数',
    unverifiedHire: false,
  }
}

export function calculateRevisionSlope(
  candidateScores: Partial<Record<RatingStage, RatingRecord>>,
): RevisionResult {
  const first = candidateScores.T1
  const lastStage: RatingStage | null = candidateScores.T3
    ? 'T3'
    : candidateScores.T2
      ? 'T2'
      : null
  if (!first || !lastStage) return null

  const last = candidateScores[lastStage]
  if (!last) return null
  const elapsedSec = last.elapsedSec - first.elapsedSec
  if (elapsedSec <= 0) return null

  const delta = last.value - first.value
  return {
    value: delta / elapsedSec,
    delta,
    elapsedSec,
    fromStage: 'T1',
    toStage: lastStage,
  }
}

export function detectAttentionDisengagementFailure(
  logs: GameLog[],
): {
  failed: boolean
  candidateIds: string[]
  explanation: string
} {
  const points = new Map<string, number>()
  const continued = new Set<string>()

  for (const log of logs.filter((item) => item.type === 'verify')) {
    if (!log.candidateId) continue
    points.set(
      log.candidateId,
      (points.get(log.candidateId) ?? 0) + (log.pointsSpent ?? 0),
    )
    if (log.addedAfterNegative) continued.add(log.candidateId)
  }

  const candidateIds = [...continued].filter((id) => {
    const candidate = candidateById[id]
    return candidate?.isToxic && (points.get(id) ?? 0) >= 5 * 0.4
  })

  return {
    failed: candidateIds.length > 0,
    candidateIds,
    explanation:
      candidateIds.length > 0
        ? `负面证据出现后，仍在候选人 ${candidateIds.join('、')} 上追加并累计投入至少 40% 资源。`
        : '能够在不利信息出现后停止无效追加，注意力脱离表现稳定。',
  }
}

export function classifyStrategy(logs: GameLog[]): StrategyType {
  const verifyLogs = logs
    .filter((log) => log.type === 'verify')
    .sort((a, b) => a.elapsedSec - b.elapsedSec)
  const firstThree = verifyLogs.slice(0, 3)
  const earlyToxicPoints = firstThree.reduce((sum, log) => {
    const candidate = log.candidateId
      ? candidateById[log.candidateId]
      : undefined
    return sum + (candidate?.isToxic ? (log.pointsSpent ?? 0) : 0)
  }, 0)
  const shallowCandidates = new Set(
    verifyLogs
      .filter((log) => log.verifyType === 'shallow')
      .map((log) => log.candidateId)
      .filter(Boolean),
  )
  const deepQuality = verifyLogs.some((log) => {
    const candidate = log.candidateId
      ? candidateById[log.candidateId]
      : undefined
    return log.verifyType === 'deep' && (candidate?.trueAbility ?? 0) >= 80
  })

  if (earlyToxicPoints >= 3) return '习惯性捷径型'
  if (shallowCandidates.size >= 2 && deepQuality) return '目标导向型'
  return earlyToxicPoints >= 2 ? '习惯性捷径型' : '目标导向型'
}

export function classifyLossAversion(choice: SunkCostChoice): string {
  if (choice === 'continue') {
    return '高损失厌恶：已有投入影响了后续判断，倾向用更多资源证明最初选择。'
  }
  if (choice === 'stop_loss') {
    return '理性止损：能把已投入资源视为不可追回成本，并依据新证据调整。'
  }
  if (choice === 'give_up') {
    return '极端风险规避或高元认知：主动退出可避免继续损失，但也可能放弃仍有价值的选择。'
  }
  return '未触发或未作答：本轮没有足够行为用于判断沉没成本倾向。'
}

const clamp = (value: number) => Math.max(0, Math.min(100, value))

export function calculateRDI(reportData: RDIInput): RDIResult {
  const attentionScore = reportData.attentionFailed ? 20 : 100
  const strategyScore =
    reportData.strategy === '目标导向型' ? 100 : 35
  const lossScore =
    reportData.lossChoice === 'stop_loss'
      ? 100
      : reportData.lossChoice === 'give_up'
        ? 60
        : reportData.lossChoice === 'continue'
          ? 20
          : 50
  const score = Math.round(
    reportData.selectedAbility * 0.25 +
      reportData.selectedFit * 0.2 +
      clamp(reportData.revisionQuality) * 0.2 +
      attentionScore * 0.15 +
      strategyScore * 0.1 +
      lossScore * 0.1,
  )
  const level =
    score >= 75 ? '高韧性' : score >= 50 ? '中间型' : '脆弱型'

  return {
    score: clamp(score),
    level,
    explanation:
      'MVP 使用能力匹配、评分修正、劣势信息脱离、查证策略和止损选择的加权 0-100 分；单人结果不是临床诊断。',
    rawData: reportData,
  }
}
