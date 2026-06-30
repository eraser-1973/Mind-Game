import { candidateById, candidates } from '../data/candidates'
import type { GameState, ReportData } from '../types/game'
import {
  calculateRDI,
  calculateRevisionSlope,
  calculateROI,
  classifyLossAversion,
  classifyStrategy,
  detectAttentionDisengagementFailure,
} from './scoring'

const getRevisionQuality = (
  revisions: ReportData['revisions'],
): number => {
  const scored = revisions
    .filter((item) => item.result !== null)
    .map(({ candidate, result }) => {
      if (!result) return 50
      const usefulDirection = candidate.isToxic
        ? -result.delta
        : result.delta
      return Math.max(0, Math.min(100, 50 + usefulDirection * 2))
    })
  if (scored.length === 0) return 50
  return scored.reduce((sum, value) => sum + value, 0) / scored.length
}

export function generateReport(state: GameState): ReportData {
  if (!state.finalCandidateId) {
    throw new Error('生成报告前必须选择最终录用者。')
  }
  const selectedCandidate = candidateById[state.finalCandidateId]
  const selectedRuntime = state.runtime[state.finalCandidateId]
  const revisions = candidates.map((candidate) => ({
    candidate,
    result: calculateRevisionSlope(
      state.runtime[candidate.id].ratings,
    ),
  }))
  const attention = detectAttentionDisengagementFailure(state.logs)
  const strategy = classifyStrategy(state.logs)
  const revisionQuality = getRevisionQuality(revisions)
  const rdi = calculateRDI({
    selectedAbility: selectedCandidate.trueAbility,
    selectedFit: selectedCandidate.trueFit,
    attentionFailed: attention.failed,
    strategy,
    lossChoice: state.sunkCostChoice,
    revisionQuality,
  })

  return {
    generatedAt: new Date().toISOString(),
    mode: state.mode,
    selectedCandidate,
    selectedRuntime,
    roi: calculateROI(
      selectedCandidate,
      selectedRuntime.spentPoints,
    ),
    revisions,
    attention,
    strategy,
    strategyExplanation:
      strategy === '目标导向型'
        ? '行为更接近先横向筛选、再把稀缺资源集中到高价值证据。'
        : '早期资源较多流向高光环候选人，决策更依赖熟悉标签和第一印象。',
    lossAversion: classifyLossAversion(state.sunkCostChoice),
    rdi,
    logs: state.logs,
    runtime: state.runtime,
    sunkCostChoice: state.sunkCostChoice,
  }
}
