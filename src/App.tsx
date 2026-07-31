import { useState } from 'react'
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
  FormalSessionContext,
  GameMode,
  GameState,
  ResearchData,
  ResearchStep,
  StateAssessmentData,
  TaskExperienceData,
} from './types/game'
import { createResearchData } from './utils/researchData'
import { generateReport } from './utils/report'
import { createFormalSession } from './api/formalSessions'
import {
  clearPendingCreationKey,
  getOrCreatePendingCreationKey,
  saveFormalSessionContext,
} from './utils/formalSessionStorage'
import { isFormalSessionContext } from './utils/formalSessionContext'

const CLIENT_VERSION = import.meta.env.VITE_COMMIT_SHA ?? 'web-1.0.0'

export default function App() {
  const [mode, setMode] = useState<GameMode | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const [researchStep, setResearchStep] = useState<ResearchStep | null>(
    null,
  )
  const [researchData, setResearchData] =
    useState<ResearchData | null>(null)
  const [completedGameState, setCompletedGameState] =
    useState<GameState | null>(null)

  const resetSession = () => {
    clearPendingCreationKey()
    setMode(null)
    setResearchStep(null)
    setResearchData(null)
    setCompletedGameState(null)
    setSessionKey((value) => value + 1)
  }

  const updateResearch = (updater: (data: ResearchData) => ResearchData) => {
    setResearchData((current) => {
      const base = current ?? createResearchData()
      return updater(base)
    })
  }

  const startMode = (nextMode: GameMode) => {
    setCompletedGameState(null)
    setMode(nextMode)

    if (nextMode === 'quick') {
      setResearchData(null)
      setResearchStep(null)
      return
    }

    setResearchData(createResearchData())
    setResearchStep('consent')
  }

  if (!mode) {
    return <StartScreen onStart={startMode} />
  }

  if (mode === 'formal' && researchData) {
    if (researchStep === 'consent') {
      return (
        <ConsentScreen
          onExit={resetSession}
          onAccept={() => {
            updateResearch((current) => ({
              ...current,
              consent: {
                accepted: true,
                acceptedAt: new Date().toISOString(),
              },
            }))
            setResearchStep('identity')
          }}
        />
      )
    }

    if (researchStep === 'identity') {
      return (
        <IdentityForm
          onBack={() => setResearchStep('consent')}
          onSubmit={async (identity: FormalIdentityInput) => {
            const creationKey = getOrCreatePendingCreationKey()
            const created = await createFormalSession(
              {
                mode: 'formal',
                identity,
                clientVersion: CLIENT_VERSION,
              },
              creationKey,
            )
            const formalSession: FormalSessionContext = {
              participantId: created.participantId,
              sessionId: created.sessionId,
              configSetId: created.configSetId,
              versions: created.versions,
              candidateDisplayOrder: created.candidateDisplayOrder,
              initialOpenedCandidate: created.initialOpenedCandidate,
              createdAt: created.createdAt,
            }

            saveFormalSessionContext(formalSession)
            clearPendingCreationKey()
            updateResearch((current) => ({
              ...current,
              participantId: formalSession.participantId,
              formalSession,
            }))
            setResearchStep('demographics')
          }}
        />
      )
    }

    if (researchStep === 'demographics') {
      return (
        <DemographicForm
          initialValue={researchData.demographics}
          onBack={() => setResearchStep('consent')}
          onSubmit={(demographics: DemographicData) => {
            updateResearch((current) => ({
              ...current,
              demographics,
            }))
            setResearchStep('preTask')
          }}
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
          onSubmit={(preTask: StateAssessmentData) => {
            updateResearch((current) => ({
              ...current,
              preTask,
            }))
            setResearchStep(null)
          }}
        />
      )
    }

    if (researchStep === 'postTask') {
      return (
        <StateAssessmentScreen
          title="任务后状态评估"
          phase="after"
          initialValue={researchData.postTask}
          onSubmit={(postTask: StateAssessmentData) => {
            updateResearch((current) => ({
              ...current,
              postTask,
            }))
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
      <main className="research-screen">
        <section className="research-card">
          <span className="eyebrow">FORMAL SESSION ERROR</span>
          <h1>正式测评初始化失败</h1>
          <p className="research-card__lead">
            未找到有效的服务器会话和候选人顺序。为避免生成无效研究数据，本次正式测评不会继续。
          </p>
          <div className="research-actions">
            <button className="button button--primary" onClick={resetSession}>
              返回入口
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <GameScreen
      key={sessionKey}
      mode={mode}
      researchData={mode === 'formal' ? researchData : null}
      onGameComplete={
        mode === 'formal'
          ? (state) => {
              setCompletedGameState(state)
              setResearchStep('postTask')
            }
          : undefined
      }
      onRestart={resetSession}
    />
  )
}
