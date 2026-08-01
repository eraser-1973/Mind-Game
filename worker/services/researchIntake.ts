import type { AuthenticatedSession } from '../auth/sessionAuth'
import { isCandidateDisplayOrder } from '../domain/candidateOrder'
import {
  canSubmitConsent,
  canSubmitDemographics,
  canSubmitPreTask,
  isPreGameSessionStep,
} from '../domain/sessionSteps'
import {
  findConsentByEvent,
  findConsentForSession,
  findCurrentDemographics,
  findDemographicByEvent,
  findPreTaskQuestionnaire,
  findQuestionnaireForPhase,
  findQuestionnaireAnswers,
  findQuestionnaireByEvent,
  insertConsentAndAdvance,
  insertDemographicRevision,
  insertPreTaskQuestionnaire,
  insertPostGameQuestionnaire,
  type DemographicRow,
} from '../repositories/researchIntake'
import type {
  ConsentInput,
  DemographicsInput,
  PostGameQuestionnaireInput,
  PreTaskQuestionnaireInput,
  QuestionnaireInput,
} from '../validation/researchIntakeRequest'

export class ResearchIntakeError extends Error {
  constructor(
    readonly status: 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ResearchIntakeError'
  }
}

function conflict(code: string, message: string): ResearchIntakeError {
  return new ResearchIntakeError(409, code, message)
}

function saveFailed(): ResearchIntakeError {
  return new ResearchIntakeError(
    500,
    'RESEARCH_INTAKE_SAVE_FAILED',
    'The research intake response could not be saved.',
  )
}

function demographicProjection(row: DemographicRow) {
  const relatedExperience: unknown = JSON.parse(row.related_experience_json)
  return {
    revisionNo: row.revision_no,
    demographics: {
      ageRange: row.age_range,
      gender: row.gender,
      education: row.education,
      grade: row.grade,
      majorCategory: row.major_category,
      relatedExperience,
    },
    submittedAt: row.client_submitted_at,
  }
}

export async function saveConsent(
  db: D1Database,
  session: AuthenticatedSession,
  input: ConsentInput,
) {
  const replay = await findConsentByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return {
      created: false,
      sessionId: session.sessionId,
      currentStep: 'demographics' as const,
      consent: {
        accepted: true as const,
        version: replay.consent_version,
        acceptedAt: replay.client_accepted_at,
      },
    }
  }
  const existing = await findConsentForSession(db, session.sessionId)
  if (existing) {
    if (existing.consent_version !== input.consentVersion) {
      throw conflict(
        'CONSENT_VERSION_CONFLICT',
        'The recorded consent version cannot be changed.',
      )
    }
    return {
      created: false,
      sessionId: session.sessionId,
      currentStep: 'demographics' as const,
      consent: {
        accepted: true as const,
        version: existing.consent_version,
        acceptedAt: existing.client_accepted_at,
      },
    }
  }
  if (!canSubmitConsent(session.currentStep)) {
    throw conflict('INVALID_SESSION_STEP', 'Consent cannot be submitted at the current step.')
  }
  try {
    await insertConsentAndAdvance(db, input, new Date().toISOString())
  } catch {
    const winner = await findConsentByEvent(db, input.eventId)
    if (winner?.session_id === session.sessionId) {
      return {
        created: false,
        sessionId: session.sessionId,
        currentStep: 'demographics' as const,
        consent: {
          accepted: true as const,
          version: winner.consent_version,
          acceptedAt: winner.client_accepted_at,
        },
      }
    }
    throw saveFailed()
  }
  return {
    created: true,
    sessionId: session.sessionId,
    currentStep: 'demographics' as const,
    consent: {
      accepted: true as const,
      version: input.consentVersion,
      acceptedAt: input.clientAcceptedAt,
    },
  }
}

export async function saveDemographics(
  db: D1Database,
  session: AuthenticatedSession,
  input: DemographicsInput,
) {
  const replay = await findDemographicByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return {
      created: false,
      sessionId: session.sessionId,
      currentStep: 'pre_task' as const,
      ...demographicProjection(replay),
    }
  }
  if (!canSubmitDemographics(session.currentStep)) {
    throw conflict('INVALID_SESSION_STEP', 'Demographics cannot be submitted at the current step.')
  }
  const current = await findCurrentDemographics(db, session.sessionId)
  const revisionNo = (current?.revision_no ?? 0) + 1
  try {
    await insertDemographicRevision(db, input, revisionNo, new Date().toISOString())
  } catch {
    const winner = await findDemographicByEvent(db, input.eventId)
    if (winner?.session_id === session.sessionId) {
      return {
        created: false,
        sessionId: session.sessionId,
        currentStep: 'pre_task' as const,
        ...demographicProjection(winner),
      }
    }
    throw saveFailed()
  }
  return {
    created: true,
    sessionId: session.sessionId,
    currentStep: 'pre_task' as const,
    revisionNo,
    demographics: input.demographics,
    submittedAt: input.clientSubmittedAt,
  }
}

export async function savePreTaskQuestionnaire(
  db: D1Database,
  session: AuthenticatedSession,
  input: PreTaskQuestionnaireInput,
) {
  const replay = await findQuestionnaireByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return {
      created: false,
      sessionId: session.sessionId,
      currentStep: 'game_ready' as const,
      submissionId: replay.submission_id,
      itemCount: replay.item_count,
    }
  }
  if (await findPreTaskQuestionnaire(db, session.sessionId)) {
    throw conflict('QUESTIONNAIRE_ALREADY_SUBMITTED', 'The pre-task questionnaire has already been submitted.')
  }
  if (!canSubmitPreTask(session.currentStep)) {
    throw conflict('INVALID_SESSION_STEP', 'The pre-task questionnaire cannot be submitted at the current step.')
  }
  const submissionId = crypto.randomUUID()
  try {
    await insertPreTaskQuestionnaire(
      db,
      input,
      submissionId,
      new Date().toISOString(),
    )
  } catch {
    const winner = await findQuestionnaireByEvent(db, input.eventId)
    if (winner?.session_id === session.sessionId) {
      return {
        created: false,
        sessionId: session.sessionId,
        currentStep: 'game_ready' as const,
        submissionId: winner.submission_id,
        itemCount: winner.item_count,
      }
    }
    throw saveFailed()
  }
  return {
    created: true,
    sessionId: session.sessionId,
    currentStep: 'game_ready' as const,
    submissionId,
    itemCount: input.answers.length,
  }
}

type RunSequenceRow = { last_sequence_no: number }

function postGameQuestionnaireProjection(
  row: {
    submission_id: string
    session_id: string
    phase: string
    item_count: number
    sequence_no: number | null
  },
  created: boolean,
) {
  if (row.sequence_no === null) throw saveFailed()
  return {
    created,
    sessionId: row.session_id,
    currentStep: row.phase === 'post'
      ? 'task_experience' as const
      : 'completion_pending' as const,
    submissionId: row.submission_id,
    itemCount: row.item_count,
    sequenceNo: row.sequence_no,
  }
}

export async function savePostGameQuestionnaire(
  db: D1Database,
  session: AuthenticatedSession,
  input: PostGameQuestionnaireInput,
) {
  const replay = await findQuestionnaireByEvent(db, input.eventId)
  if (replay) {
    if (replay.session_id !== session.sessionId || replay.phase !== input.phase) {
      throw conflict('IDEMPOTENCY_CONFLICT', 'The idempotency key cannot be reused.')
    }
    return postGameQuestionnaireProjection(replay, false)
  }
  if (await findQuestionnaireForPhase(db, session.sessionId, input.phase)) {
    throw conflict(
      'QUESTIONNAIRE_ALREADY_SUBMITTED',
      'The questionnaire has already been submitted.',
    )
  }
  const expectedStep = input.phase === 'post' ? 'post_task' : 'task_experience'
  if (session.currentStep !== expectedStep) {
    throw conflict(
      'INVALID_SESSION_STEP',
      'The questionnaire cannot be submitted at the current step.',
    )
  }
  const finalDecision = await db.prepare(
    'SELECT final_decision_id FROM final_decisions WHERE session_id=?',
  ).bind(session.sessionId).first<{ final_decision_id: string }>()
  if (!finalDecision) {
    throw conflict('FINAL_DECISION_REQUIRED', 'A sealed final decision is required.')
  }
  if (input.phase === 'task_experience' &&
    !(await findQuestionnaireForPhase(db, session.sessionId, 'post'))) {
    throw conflict('POST_TASK_REQUIRED', 'The post-task questionnaire is required.')
  }

  let run = await db.prepare(
    'SELECT last_sequence_no FROM game_runs WHERE session_id=?',
  ).bind(session.sessionId).first<RunSequenceRow>()
  if (!run) throw conflict('GAME_NOT_STARTED', 'The formal game has not been started.')

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const submissionId = crypto.randomUUID()
    const sequenceNo = run.last_sequence_no + 1
    try {
      await insertPostGameQuestionnaire(
        db,
        input,
        submissionId,
        sequenceNo,
        run.last_sequence_no,
        new Date().toISOString(),
      )
      const saved = await findQuestionnaireByEvent(db, input.eventId)
      if (!saved) throw saveFailed()
      return postGameQuestionnaireProjection(saved, true)
    } catch {
      const winner = await findQuestionnaireByEvent(db, input.eventId)
      if (winner?.session_id === session.sessionId && winner.phase === input.phase) {
        return postGameQuestionnaireProjection(winner, false)
      }
      if (await findQuestionnaireForPhase(db, session.sessionId, input.phase)) {
        throw conflict(
          'QUESTIONNAIRE_ALREADY_SUBMITTED',
          'The questionnaire has already been submitted.',
        )
      }
      const latest = await db.prepare(
        'SELECT last_sequence_no FROM game_runs WHERE session_id=?',
      ).bind(session.sessionId).first<RunSequenceRow>()
      if (!latest) throw saveFailed()
      run = latest
    }
  }
  throw saveFailed()
}

export function saveQuestionnaire(
  db: D1Database,
  session: AuthenticatedSession,
  input: QuestionnaireInput,
) {
  return input.phase === 'pre'
    ? savePreTaskQuestionnaire(db, session, input)
    : savePostGameQuestionnaire(db, session, input)
}

export async function loadResumeProjection(
  db: D1Database,
  session: AuthenticatedSession,
) {
  if (!isPreGameSessionStep(session.currentStep)) {
    throw conflict(
      'GAME_RESUME_NOT_READY',
      'Gameplay resume is not available in this implementation stage.',
    )
  }
  let candidateDisplayOrder: unknown
  try {
    candidateDisplayOrder = JSON.parse(session.candidateDisplayOrder)
  } catch {
    throw saveFailed()
  }
  if (!isCandidateDisplayOrder(candidateDisplayOrder)) throw saveFailed()

  const [consent, demographics, preTask] = await Promise.all([
    findConsentForSession(db, session.sessionId),
    findCurrentDemographics(db, session.sessionId),
    findPreTaskQuestionnaire(db, session.sessionId),
  ])
  const answers = preTask
    ? await findQuestionnaireAnswers(db, preTask.submission_id)
    : []

  const invalidIntegrity =
    session.startedAt !== null ||
    session.deadlineAt !== null ||
    (session.currentStep === 'consent_pending' && Boolean(consent || demographics || preTask)) ||
    (session.currentStep === 'demographics' && (!consent || Boolean(demographics || preTask))) ||
    (session.currentStep === 'pre_task' && (!consent || !demographics || Boolean(preTask))) ||
    (session.currentStep === 'game_ready' && (
      !consent ||
      !demographics ||
      !preTask ||
      answers.length !== 5 ||
      answers.some((answer) => answer.touched !== 1)
    ))
  if (invalidIntegrity) {
    throw conflict(
      'SESSION_DATA_INTEGRITY_ERROR',
      'The formal session data is internally inconsistent and cannot be resumed.',
    )
  }

  return {
    session: {
      participantId: session.participantId,
      sessionId: session.sessionId,
      mode: 'formal' as const,
      configSetId: session.configSetId,
      versions: {
        task: session.taskVersion,
        material: session.materialVersion,
        pointRule: session.pointRuleVersion,
        sunkCostRule: session.sunkCostRuleVersion,
        scoring: session.scoringVersion,
        benchmark: session.benchmarkVersion,
        norm: session.normVersion,
      },
      candidateDisplayOrder,
      initialOpenedCandidate: session.initialOpenedCandidate,
      currentStep: session.currentStep,
      createdAt: session.createdAt,
    },
    consent: consent ? {
      accepted: true as const,
      version: consent.consent_version,
      acceptedAt: consent.client_accepted_at,
    } : null,
    demographics: demographics ? demographicProjection(demographics) : null,
    preTask: preTask ? {
      instrumentVersion: preTask.instrument_version,
      startedAt: preTask.client_started_at,
      submittedAt: preTask.client_submitted_at,
      answers: answers.map((answer) => ({
        itemId: answer.item_id,
        value: answer.value,
        touched: answer.touched === 1,
        answeredAt: answer.answered_at,
      })),
    } : null,
    game: {
      startedAt: session.startedAt,
      deadlineAt: session.deadlineAt,
      resumeSupported: false,
    },
  }
}
