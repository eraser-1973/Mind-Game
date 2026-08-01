export type PublicQuestionnairePhase = 'pre' | 'post' | 'task_experience'

export type QuestionnaireInstrumentItem = {
  id: string
  min: number
  max: number
}

export type QuestionnaireInstrument = {
  phase: PublicQuestionnairePhase
  version: string
  items: readonly QuestionnaireInstrumentItem[]
}

const stateItems = [
  'stress',
  'fatigue',
  'attention',
  'mood',
  'physicalDiscomfort',
] as const

export const PRE_TASK_INSTRUMENT = {
  phase: 'pre',
  version: 'state-assessment-pre-1.0.0',
  items: stateItems.map((id) => ({ id, min: 0, max: 10 })),
} as const satisfies QuestionnaireInstrument

export const POST_TASK_INSTRUMENT = {
  phase: 'post',
  version: 'state-assessment-post-1.0.0',
  items: stateItems.map((id) => ({ id, min: 0, max: 10 })),
} as const satisfies QuestionnaireInstrument

const agreementItems = [
  'timePressure1',
  'timePressure2',
  'resourceLimit1',
  'resourceLimit2',
  'socialEvaluation1',
  'socialEvaluation2',
  'outcomeResponsibility1',
  'outcomeResponsibility2',
  'uncontrollability1',
  'uncontrollability2',
  'cognitiveLoad1',
  'cognitiveLoad2',
  'cognitiveLoad3',
  'cognitiveLoad4',
] as const

export const TASK_EXPERIENCE_INSTRUMENT = {
  phase: 'task_experience',
  version: 'task-experience-1.0.0',
  items: [
    ...agreementItems.map((id) => ({ id, min: 1, max: 10 })),
    { id: 'decisionConfidence', min: 0, max: 10 },
  ],
} as const satisfies QuestionnaireInstrument

export const PUBLIC_QUESTIONNAIRE_INSTRUMENTS = [
  PRE_TASK_INSTRUMENT,
  POST_TASK_INSTRUMENT,
  TASK_EXPERIENCE_INSTRUMENT,
] as const

export function findQuestionnaireInstrument(
  phase: string,
): QuestionnaireInstrument | null {
  return PUBLIC_QUESTIONNAIRE_INSTRUMENTS.find(
    (instrument) => instrument.phase === phase,
  ) ?? null
}
