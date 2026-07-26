import { useState } from 'react'
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
          participantId={researchData.participantId}
          onExit={resetSession}
          onAccept={() => {
            updateResearch((current) => ({
              ...current,
              consent: {
                accepted: true,
                acceptedAt: new Date().toISOString(),
              },
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
