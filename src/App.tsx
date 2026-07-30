import { useCallback, useEffect, useState } from 'react'
import { ConsentScreen } from './components/ConsentScreen'
import { DemographicForm } from './components/DemographicForm'
import { GameScreen } from './components/GameScreen'
import { ReportScreen } from './components/ReportScreen'
import { StartScreen } from './components/StartScreen'
import { StateAssessmentScreen } from './components/StateAssessmentScreen'
import { TaskExperienceScreen } from './components/TaskExperienceScreen'
import type {
  DemographicData,
  GameMode,
  GameState,
  ResearchData,
  ResearchStep,
  StateAssessmentData,
  TaskExperienceData,
} from './types/game'
import { createResearchData } from './utils/researchData'
import { generateReport } from './utils/report'
import { useFormalSession } from './hooks/useFormalSession'

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
  const [restoredGameState, setRestoredGameState] = useState<GameState | null>(null)
  const formalSession = useFormalSession()

  useEffect(() => {
    void formalSession.restore().then((snapshot) => {
      if (!snapshot) return
      setMode('formal')
      setResearchData(snapshot.researchData)
      setResearchStep(snapshot.researchStep)
      setRestoredGameState(snapshot.gameState)
      if (snapshot.gameState?.phase === 'report') setCompletedGameState(snapshot.gameState)
    }).catch(() => undefined)
  }, [])

  const resetSession = () => {
    setMode(null)
    setResearchStep(null)
    setResearchData(null)
    setCompletedGameState(null)
    setRestoredGameState(null)
    setSessionKey((value) => value + 1)
  }

  const updateResearch = (updater: (data: ResearchData) => ResearchData) => {
    setResearchData((current) => {
      const base = current ?? createResearchData()
      return updater(base)
    })
  }

  useEffect(() => {
    if (mode !== 'formal' || !researchData || !formalSession.credentials) return
    void formalSession.persist({ researchStep, researchData, gameState: restoredGameState ?? completedGameState })
  }, [completedGameState, mode, researchData, researchStep, restoredGameState, formalSession.credentials])

  const acceptConsent = useCallback(async () => {
    if (!researchData) return
    const next = { ...researchData, consent: { accepted: true, acceptedAt: new Date().toISOString() } }
    setResearchData(next)
    try {
      await formalSession.create(next)
      setResearchStep('demographics')
    } catch { /* gate remains visible with retry */ }
  }, [formalSession, researchData])

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
          participantId={researchData.participantId}
          onExit={resetSession}
          onAccept={() => { void acceptConsent() }}
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

  return (
    mode === 'formal' && formalSession.status === 'error' ? (
      <main className="research-screen"><section className="research-card" role="alert">
        <span className="eyebrow">SESSION CONNECTION</span><h1>暂时无法创建或恢复实验会话</h1>
        <p className="research-card__lead">{formalSession.error}</p>
        <div className="research-actions"><button className="button button--primary" onClick={() => { if (researchData?.consent.accepted) void acceptConsent() }}>重试</button><button className="button button--ghost" onClick={resetSession}>安全退出</button></div>
      </section></main>
    ) :
    <GameScreen
      key={sessionKey}
      mode={mode}
      researchData={mode === 'formal' ? researchData : null}
      initialState={mode === 'formal' ? restoredGameState : null}
      onStateChange={mode === 'formal' ? (state) => {
        setRestoredGameState(state)
        if (researchData) void formalSession.persist({ researchStep, researchData, gameState: state })
      } : undefined}
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
