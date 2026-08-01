import { useEffect, useState } from 'react'
import {
  FormalResearchApiError,
  resumeFormalSession,
  saveFormalConsent,
  saveFormalDemographics,
  saveFormalPreTaskQuestionnaire,
} from './api/formalResearch'
import { createFormalSession } from './api/formalSessions'
import { ConsentScreen } from './components/ConsentScreen'
import { DemographicForm } from './components/DemographicForm'
import { GameScreen } from './components/GameScreen'
import { IdentityForm } from './components/IdentityForm'
import { ReportScreen } from './components/ReportScreen'
import { StartScreen } from './components/StartScreen'
import { StateAssessmentScreen } from './components/StateAssessmentScreen'
import { TaskExperienceScreen } from './components/TaskExperienceScreen'
import type {
  DemographicData,
  FormalIdentityInput,
  FormalResumeData,
  FormalSessionContext,
  FormalSessionStep,
  GameMode,
  GameState,
  ResearchData,
  ResearchStep,
  StateAssessmentData,
  StateAssessmentId,
  TaskExperienceData,
} from './types/game'
import type { FormalGameSnapshot } from './types/formalGame'
import { isFormalSessionContext } from './utils/formalSessionContext'
import {
  clearPendingCreationKey,
  clearPendingOperationKey,
  getOrCreatePendingCreationKey,
  getOrCreatePendingOperationKey,
  loadFormalSessionContext,
  removeFormalSessionContext,
  saveFormalSessionContext,
} from './utils/formalSessionStorage'
import { generateReport } from './utils/report'
import { createResearchData } from './utils/researchData'
import { clearAllFormalGamePendingKeys } from './utils/formalPendingKeys'

const CLIENT_VERSION = import.meta.env.VITE_COMMIT_SHA ?? 'web-1.0.0'
const CONSENT_VERSION = 'consent-1.0.0' as const

type RecoveryState =
  | 'checking'
  | 'resumed'
  | 'no_session'
  | 'unauthorized'
  | 'unsupported_game_resume'
  | 'error'

type FormalActionError = {
  kind: 'consent'
  message: string
} | null

function contextAtStep(
  context: FormalSessionContext,
  currentStep: FormalSessionStep,
): FormalSessionContext {
  return { ...context, currentStep }
}

function preTaskValues(resume: FormalResumeData): StateAssessmentData | null {
  if (!resume.preTask || resume.preTask.answers.length !== 5) return null
  const values = Object.fromEntries(
    resume.preTask.answers.map((answer) => [answer.itemId, answer.value]),
  ) as Partial<StateAssessmentData>
  const ids: StateAssessmentId[] = [
    'stress', 'fatigue', 'attention', 'mood', 'physicalDiscomfort',
  ]
  if (ids.some((id) => !Number.isInteger(values[id]))) return null
  return values as StateAssessmentData
}

function researchFromResume(resume: FormalResumeData): ResearchData {
  const base = createResearchData(new Date(resume.session.createdAt))
  return {
    ...base,
    participantId: resume.session.participantId,
    formalSession: resume.session,
    consent: resume.consent
      ? {
          accepted: true,
          acceptedAt: resume.consent.acceptedAt,
          version: resume.consent.version,
        }
      : base.consent,
    demographics: resume.demographics?.demographics ?? null,
    preTask: preTaskValues(resume),
  }
}

function stepToResearchStep(step: FormalSessionStep): ResearchStep | null {
  if (step === 'consent_pending') return 'consent'
  if (step === 'demographics') return 'demographics'
  if (step === 'pre_task') return 'preTask'
  if (step === 'game_ready') return null
  return null
}

function StatusScreen({
  eyebrow,
  title,
  message,
  testId,
  onRetry,
  onExit,
}: {
  eyebrow: string
  title: string
  message: string
  testId: string
  onRetry?: () => void | Promise<void>
  onExit: () => void
}) {
  return (
    <main className="research-screen" data-testid={testId}>
      <section className="research-card">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="research-card__lead">{message}</p>
        <div className="research-actions">
          <button className="button button--ghost" onClick={onExit}>返回入口</button>
          {onRetry && (
            <button
              className="button button--primary"
              data-testid={testId === 'formal-consent-sync-error' ? 'retry-formal-consent' : 'formal-recovery-retry'}
              onClick={() => {
                void Promise.resolve(onRetry()).catch(() => undefined)
              }}
            >
              重试
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const [mode, setMode] = useState<GameMode | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const [researchStep, setResearchStep] = useState<ResearchStep | null>(null)
  const [researchData, setResearchData] = useState<ResearchData | null>(null)
  const [completedGameState, setCompletedGameState] = useState<GameState | null>(null)
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking')
  const [formalActionError, setFormalActionError] = useState<FormalActionError>(null)
  const [formalGameSnapshot, setFormalGameSnapshot] = useState<FormalGameSnapshot | null>(null)

  const clearPendingKeys = () => {
    clearPendingCreationKey()
    clearPendingOperationKey('consent')
    clearPendingOperationKey('demographics')
    clearPendingOperationKey('preTask')
    clearAllFormalGamePendingKeys()
  }

  const resetSession = () => {
    clearPendingKeys()
    removeFormalSessionContext()
    setMode(null)
    setResearchStep(null)
    setResearchData(null)
    setCompletedGameState(null)
    setFormalActionError(null)
    setFormalGameSnapshot(null)
    setRecoveryState('no_session')
    setSessionKey((value) => value + 1)
  }

  const updateResearch = (updater: (data: ResearchData) => ResearchData) => {
    setResearchData((current) => updater(current ?? createResearchData()))
  }

  const persistContext = (
    context: FormalSessionContext,
    extra?: (current: ResearchData) => ResearchData,
  ) => {
    saveFormalSessionContext(context)
    updateResearch((current) => {
      const next = {
        ...current,
        participantId: context.participantId,
        formalSession: context,
      }
      return extra ? extra(next) : next
    })
  }

  const applyResume = (resume: FormalResumeData) => {
    saveFormalSessionContext(resume.session)
    setMode('formal')
    setResearchData(researchFromResume(resume))
    setResearchStep(stepToResearchStep(resume.session.currentStep))
    setRecoveryState('resumed')
    setFormalActionError(null)
    setFormalGameSnapshot(resume.game.resumeSupported ? resume.game : null)
  }

  const recoverFormalSession = async () => {
    const context = loadFormalSessionContext()
    if (!context) {
      setRecoveryState('no_session')
      return
    }
    setRecoveryState('checking')
    try {
      applyResume(await resumeFormalSession(context.sessionId))
    } catch (error) {
      if (error instanceof FormalResearchApiError) {
        if (
          error.code === 'SESSION_UNAUTHORIZED' ||
          error.code === 'SESSION_REVOKED' ||
          error.code === 'SESSION_NOT_ACTIVE'
        ) {
          removeFormalSessionContext()
          setRecoveryState('unauthorized')
          return
        }
        if (error.code === 'GAME_RESUME_NOT_READY') {
          setRecoveryState('unsupported_game_resume')
          return
        }
      }
      setRecoveryState('error')
    }
  }

  useEffect(() => {
    void recoverFormalSession()
    // Session recovery is intentionally attempted once on application startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startMode = (nextMode: GameMode) => {
    setCompletedGameState(null)
    setMode(nextMode)
    setFormalActionError(null)
    setFormalGameSnapshot(null)
    if (nextMode === 'quick') {
      setResearchData(null)
      setResearchStep(null)
      return
    }
    setResearchData(createResearchData())
    setResearchStep('consent')
  }

  const submitConsentForSession = async (
    context: FormalSessionContext,
    acceptedAt: string,
  ) => {
    const eventId = getOrCreatePendingOperationKey('consent')
    try {
      const result = await saveFormalConsent({
        sessionId: context.sessionId,
        accepted: true,
        consentVersion: CONSENT_VERSION,
        clientAcceptedAt: acceptedAt,
      }, eventId)
      const nextContext = contextAtStep(context, result.currentStep)
      persistContext(nextContext, (current) => ({
        ...current,
        consent: {
          accepted: true,
          acceptedAt: result.consent.acceptedAt,
          version: result.consent.version,
        },
      }))
      clearPendingOperationKey('consent')
      setFormalActionError(null)
      setResearchStep('demographics')
    } catch (error) {
      setFormalActionError({
        kind: 'consent',
        message: error instanceof Error ? error.message : '知情同意暂时无法保存，请重试。',
      })
      throw error
    }
  }

  const acceptConsent = async () => {
    const acceptedAt = researchData?.consent.acceptedAt ?? new Date().toISOString()
    updateResearch((current) => ({
      ...current,
      consent: { accepted: true, acceptedAt, version: CONSENT_VERSION },
    }))
    const context = researchData?.formalSession
    if (!context) {
      setResearchStep('identity')
      return
    }
    if (context.currentStep === 'consent_pending') {
      await submitConsentForSession(context, acceptedAt)
      return
    }
    setResearchStep(stepToResearchStep(context.currentStep))
  }

  const createSessionAndPersistConsent = async (identity: FormalIdentityInput) => {
    const acceptedAt = researchData?.consent.acceptedAt
    if (!acceptedAt) throw new Error('请先确认知情同意。')

    let context = researchData?.formalSession ?? null
    if (!isFormalSessionContext(context)) {
      const creationKey = getOrCreatePendingCreationKey()
      const created = await createFormalSession(
        { mode: 'formal', identity, clientVersion: CLIENT_VERSION },
        creationKey,
      )
      context = {
        participantId: created.participantId,
        sessionId: created.sessionId,
        configSetId: created.configSetId,
        versions: created.versions,
        candidateDisplayOrder: created.candidateDisplayOrder,
        initialOpenedCandidate: created.initialOpenedCandidate,
        currentStep: created.currentStep,
        createdAt: created.createdAt,
      }
      persistContext(context)
      clearPendingCreationKey()
    }

    await submitConsentForSession(context, acceptedAt)
  }

  const submitDemographics = async (demographics: DemographicData) => {
    const context = researchData?.formalSession
    if (!isFormalSessionContext(context)) throw new Error('正式会话无效，请返回入口重试。')
    const eventId = getOrCreatePendingOperationKey('demographics')
    const result = await saveFormalDemographics({
      sessionId: context.sessionId,
      demographics,
      clientSubmittedAt: new Date().toISOString(),
    }, eventId)
    const nextContext = contextAtStep(context, result.currentStep)
    persistContext(nextContext, (current) => ({ ...current, demographics: result.demographics }))
    clearPendingOperationKey('demographics')
    setResearchStep('preTask')
  }

  const submitPreTask = async (
    preTask: StateAssessmentData,
    metadata: { startedAt: string; submittedAt: string },
  ) => {
    const context = researchData?.formalSession
    if (!isFormalSessionContext(context)) throw new Error('正式会话无效，请返回入口重试。')
    const eventId = getOrCreatePendingOperationKey('preTask')
    const result = await saveFormalPreTaskQuestionnaire({
      sessionId: context.sessionId,
      values: preTask,
      clientStartedAt: metadata.startedAt,
      clientSubmittedAt: metadata.submittedAt,
    }, eventId)
    const nextContext = contextAtStep(context, result.currentStep)
    persistContext(nextContext, (current) => ({ ...current, preTask }))
    clearPendingOperationKey('preTask')
    setResearchStep(null)
  }

  if (recoveryState === 'checking') {
    return (
      <StatusScreen
        eyebrow="FORMAL SESSION"
        title="正在检查未完成会话"
        message="正在安全恢复本浏览器中的正式测评进度。"
        testId="formal-recovery-checking"
        onExit={resetSession}
      />
    )
  }
  if (recoveryState === 'unauthorized') {
    return (
      <StatusScreen
        eyebrow="FORMAL SESSION"
        title="会话已失效"
        message="未完成会话已过期或无法验证，请返回入口重新开始。"
        testId="formal-session-expired"
        onExit={resetSession}
      />
    )
  }
  if (recoveryState === 'unsupported_game_resume') {
    return (
      <StatusScreen
        eyebrow="FORMAL SESSION"
        title="游戏阶段暂不支持自动恢复"
        message="服务器已保留会话状态；为避免重置计时、候选人顺序或研究数据，本页面不会从空白游戏继续。"
        testId="formal-game-resume-unsupported"
        onRetry={recoverFormalSession}
        onExit={resetSession}
      />
    )
  }
  if (recoveryState === 'error') {
    return (
      <StatusScreen
        eyebrow="NETWORK RECOVERY"
        title="暂时无法恢复正式会话"
        message="安全会话编号仍保存在本设备。请恢复网络后重试，或返回入口。"
        testId="formal-recovery-error"
        onRetry={recoverFormalSession}
        onExit={resetSession}
      />
    )
  }
  if (formalActionError?.kind === 'consent' && isFormalSessionContext(researchData?.formalSession)) {
    return (
      <StatusScreen
        eyebrow="CONSENT SYNC"
        title="知情同意尚未保存"
        message={`${formalActionError.message} 会话已经安全创建，重试不会再次上传身份信息。`}
        testId="formal-consent-sync-error"
        onRetry={() => submitConsentForSession(
          researchData.formalSession!,
          researchData.consent.acceptedAt!,
        )}
        onExit={resetSession}
      />
    )
  }

  if (!mode) return <StartScreen onStart={startMode} />

  if (mode === 'formal' && researchData) {
    if (researchStep === 'consent') {
      return (
        <ConsentScreen
          onExit={resetSession}
          onAccept={() => {
            void acceptConsent().catch(() => undefined)
          }}
        />
      )
    }
    if (researchStep === 'identity') {
      return (
        <IdentityForm
          onBack={() => setResearchStep('consent')}
          onSubmit={createSessionAndPersistConsent}
        />
      )
    }
    if (researchStep === 'demographics') {
      return (
        <DemographicForm
          initialValue={researchData.demographics}
          onBack={() => setResearchStep('consent')}
          onSubmit={submitDemographics}
        />
      )
    }
    if (researchStep === 'preTask') {
      return (
        <StateAssessmentScreen
          title="当前状态评估"
          phase="before"
          initialValue={researchData.preTask}
          onBack={() => setResearchStep('demographics')}
          onSubmit={(value, metadata) => submitPreTask(value, metadata)}
        />
      )
    }
    if (researchStep === 'postTask') {
      return (
        <StateAssessmentScreen
          title="任务后状态评估"
          phase="after"
          initialValue={researchData.postTask}
          onSubmit={(postTask) => {
            updateResearch((current) => ({ ...current, postTask }))
            setResearchStep('taskExperience')
          }}
        />
      )
    }
    if (researchStep === 'taskExperience') {
      return (
        <TaskExperienceScreen
          initialValue={researchData.taskExperience}
          onBack={() => setResearchStep('postTask')}
          onSubmit={(taskExperience: TaskExperienceData) => {
            updateResearch((current) => ({
              ...current,
              taskExperience,
              completedAt: new Date().toISOString(),
            }))
            setResearchStep('report')
          }}
        />
      )
    }
    if (researchStep === 'report' && completedGameState) {
      const reportState = {
        ...completedGameState,
        participantId: researchData.participantId,
        researchData,
      }
      return (
        <ReportScreen
          report={generateReport(reportState)}
          sourceState={reportState}
          onRestart={resetSession}
        />
      )
    }
  }

  if (
    mode === 'formal' &&
    researchStep === null &&
    (!researchData || !isFormalSessionContext(researchData.formalSession))
  ) {
    return (
      <StatusScreen
        eyebrow="FORMAL SESSION ERROR"
        title="正式测评初始化失败"
        message="未找到有效的服务器会话和候选人顺序。为避免生成无效研究数据，本次正式测评不会继续。"
        testId="formal-session-invalid"
        onExit={resetSession}
      />
    )
  }

  return (
    <GameScreen
      key={sessionKey}
      mode={mode}
      researchData={mode === 'formal' ? researchData : null}
      formalGameSnapshot={mode === 'formal' ? formalGameSnapshot : null}
      onFormalGameSnapshot={mode === 'formal'
        ? (snapshot) => {
            setFormalGameSnapshot(snapshot)
            const context = researchData?.formalSession
            if (context && context.currentStep !== 'playing') {
              persistContext(contextAtStep(context, 'playing'))
            }
          }
        : undefined}
      onGameComplete={mode === 'formal'
        ? (state) => {
            setCompletedGameState(state)
            setResearchStep('postTask')
          }
        : undefined}
      onRestart={resetSession}
    />
  )
}
