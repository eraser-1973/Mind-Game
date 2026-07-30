import type {
  GameState,
  ResearchData,
  StateAssessmentData,
  TaskExperienceData,
} from '../types/game'
import { defaultTaskExperience } from '../data/researchFlow'
import type { ReportData } from '../types/game'

const IDENTIFIABLE_KEYS = [
  'name',
  'phone',
  'mobile',
  'email',
  'studentId',
  'schoolId',
  'ip',
  'ipAddress',
]

export function createParticipantId(now = Date.now()): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `MG-${now.toString(36).toUpperCase()}-${random}`
}

export function createResearchData(now = new Date()): ResearchData {
  return {
    participantId: createParticipantId(now.getTime()),
    consent: {
      accepted: false,
      acceptedAt: null,
    },
    demographics: null,
    preTask: null,
    postTask: null,
    taskExperience: null,
    startedAt: now.toISOString(),
    completedAt: null,
  }
}

export function clampScaleValue(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function normalizeStateAssessment(
  data: StateAssessmentData,
): StateAssessmentData {
  return {
    stress: normalizeNullableScaleValue(data.stress, 0, 10),
    fatigue: normalizeNullableScaleValue(data.fatigue, 0, 10),
    attention: normalizeNullableScaleValue(data.attention, 0, 10),
    mood: normalizeNullableScaleValue(data.mood, 0, 10),
    physicalDiscomfort: normalizeNullableScaleValue(data.physicalDiscomfort, 0, 10),
  }
}

export function normalizeTaskExperience(
  data: TaskExperienceData,
): TaskExperienceData {
  return Object.fromEntries(
    Object.keys(defaultTaskExperience).map((key) => {
      const typedKey = key as keyof TaskExperienceData
      const min = typedKey === 'decisionConfidence' ? 0 : 1
      return [
        typedKey,
        normalizeNullableScaleValue(data[typedKey], min, 10),
      ]
    }),
  ) as TaskExperienceData
}

function normalizeNullableScaleValue(
  value: number | null,
  min: number,
  max: number,
): number | null {
  return value === null ? null : clampScaleValue(value, min, max)
}

export function isQuestionnaireComplete(
  values: Record<string, number | null>,
): boolean {
  return Object.values(values).every((value) => value !== null)
}

export function findFirstUnanswered(
  values: Record<string, number | null>,
): string | null {
  return Object.keys(values).find((key) => values[key] === null) ?? null
}

export function assertAnonymousResearchPayload(data: unknown): void {
  const json = JSON.stringify(data)
  for (const key of IDENTIFIABLE_KEYS) {
    if (new RegExp(`"${key}"\\s*:`, 'i').test(json)) {
      throw new Error(`匿名研究数据中不应包含可识别字段：${key}`)
    }
  }
}

export function buildAnonymousResearchExport(
  report: ReportData,
  state: GameState,
) {
  const payload = {
    schemaVersion: 'mind-game-anonymous-research-v1',
    exportedAt: new Date().toISOString(),
    participantId: report.participantId,
    consent: report.researchData?.consent ?? null,
    demographics: report.researchData?.demographics ?? null,
    preTask: report.researchData?.preTask ?? null,
    postTask: report.researchData?.postTask ?? null,
    taskExperience: report.researchData?.taskExperience ?? null,
    game: {
      mode: report.mode,
      durationSec: state.durationSec,
      candidate_display_order: state.candidateDisplayOrder,
      finalCandidateId: state.finalCandidateId,
      selectedCandidate: {
        id: report.selectedCandidate.id,
        role: report.selectedCandidate.role,
        trueAbility: report.selectedCandidate.trueAbility,
        trueFit: report.selectedCandidate.trueFit,
        isToxic: report.selectedCandidate.isToxic,
      },
      runtime: report.runtime,
      logs: report.logs,
      sunkCostChoice: report.sunkCostChoice,
      nikoMessages: report.nikoMessages,
    },
    reportMetrics: {
      roi: report.roi,
      revisions: report.revisions.map(({ candidate, result }) => ({
        candidateId: candidate.id,
        result,
      })),
      attention: report.attention,
      strategy: report.strategy,
      strategyExplanation: report.strategyExplanation,
      lossAversion: report.lossAversion,
      rdi: report.rdi,
    },
  }

  assertAnonymousResearchPayload(payload)
  return payload
}
