import { describe, expect, it, vi } from 'vitest'
import { createInitialGameState, gameReducer } from '../state/gameReducer'
import { generateReport } from './report'
import {
  assertAnonymousResearchPayload,
  buildAnonymousResearchExport,
  clampScaleValue,
  createResearchData,
  normalizeStateAssessment,
  normalizeTaskExperience,
} from './researchData'

describe('researchData utilities', () => {
  it('creates an anonymous participant id and consent defaults', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456)
    const research = createResearchData(new Date('2026-07-26T00:00:00.000Z'))

    expect(research.participantId).toMatch(/^MG-/)
    expect(research.consent.accepted).toBe(false)
    expect(research.demographics).toBeNull()
    expect(JSON.stringify(research)).not.toMatch(
      /"email"|"phone"|"studentId"|"ip"/i,
    )

    vi.restoreAllMocks()
  })

  it('clamps research scale values to valid ranges', () => {
    expect(clampScaleValue(12.4, 0, 10)).toBe(10)
    expect(clampScaleValue(-3, 1, 10)).toBe(1)
    expect(clampScaleValue(4.6, 0, 10)).toBe(5)

    expect(
      normalizeStateAssessment({
        stress: 11,
        fatigue: -1,
        attention: 7.4,
        mood: 5,
        physicalDiscomfort: 0,
      }),
    ).toEqual({
      stress: 10,
      fatigue: 0,
      attention: 7,
      mood: 5,
      physicalDiscomfort: 0,
    })

    expect(
      normalizeTaskExperience({
        timePressure1: 0,
        timePressure2: 12,
        resourceLimit1: 6,
        resourceLimit2: 6,
        socialEvaluation1: 6,
        socialEvaluation2: 6,
        outcomeResponsibility1: 6,
        outcomeResponsibility2: 6,
        uncontrollability1: 6,
        uncontrollability2: 6,
        cognitiveLoad1: 6,
        cognitiveLoad2: 6,
        cognitiveLoad3: 6,
        cognitiveLoad4: 6,
        decisionConfidence: -2,
      }),
    ).toMatchObject({
      timePressure1: 1,
      timePressure2: 10,
      decisionConfidence: 0,
    })
  })

  it('builds export data with questionnaires, game logs, Niko messages and report metrics', () => {
    const research = {
      ...createResearchData(new Date('2026-07-26T00:00:00.000Z')),
      consent: {
        accepted: true,
        acceptedAt: '2026-07-26T00:00:01.000Z',
      },
      preTask: {
        stress: 3,
        fatigue: 2,
        attention: 8,
        mood: 6,
        physicalDiscomfort: 0,
      },
      postTask: {
        stress: 7,
        fatigue: 5,
        attention: 6,
        mood: 4,
        physicalDiscomfort: 1,
      },
      taskExperience: normalizeTaskExperience({
        timePressure1: 8,
        timePressure2: 8,
        resourceLimit1: 9,
        resourceLimit2: 8,
        socialEvaluation1: 7,
        socialEvaluation2: 6,
        outcomeResponsibility1: 9,
        outcomeResponsibility2: 9,
        uncontrollability1: 5,
        uncontrollability2: 5,
        cognitiveLoad1: 7,
        cognitiveLoad2: 7,
        cognitiveLoad3: 6,
        cognitiveLoad4: 6,
        decisionConfidence: 8,
      }),
      completedAt: '2026-07-26T00:15:00.000Z',
    }
    let state = createInitialGameState('formal', 1_000, research)
    state = gameReducer(state, {
      type: 'RATE',
      candidateId: 'C',
      stage: 'T1',
      value: 75,
    })
    state = gameReducer(state, {
      type: 'NIKO_FEEDBACK',
      message: {
        id: 'niko-C-T2-C-shallow',
        candidateId: 'C',
        stage: 'T2',
        mood: 'happy',
        text: '你抓住了正向证据。',
        relatedEvidenceId: 'C-shallow',
        timestamp: 33,
      },
    })
    state = { ...state, finalCandidateId: 'C', phase: 'report' }
    const report = generateReport(state)
    const payload = buildAnonymousResearchExport(report, state)

    expect(payload.participantId).toBe(research.participantId)
    expect(payload.preTask?.attention).toBe(8)
    expect(payload.game.finalCandidateId).toBe('C')
    expect(payload.game.candidate_display_order.slice().sort()).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ])
    expect(payload.game.nikoMessages).toHaveLength(1)
    expect(payload.reportMetrics.rdi.score).toBeGreaterThan(0)
    expect(() => assertAnonymousResearchPayload(payload)).not.toThrow()
  })

  it('rejects direct identifiable fields in exported research payloads', () => {
    expect(() =>
      assertAnonymousResearchPayload({ email: 'test@example.com' }),
    ).toThrow('可识别字段')
  })
})
