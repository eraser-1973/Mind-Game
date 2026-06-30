import { useState } from 'react'
import { GameScreen } from './components/GameScreen'
import { StartScreen } from './components/StartScreen'
import type { GameMode } from './types/game'

export default function App() {
  const [mode, setMode] = useState<GameMode | null>(null)
  const [sessionKey, setSessionKey] = useState(0)

  if (!mode) {
    return <StartScreen onStart={setMode} />
  }

  return (
    <GameScreen
      key={sessionKey}
      mode={mode}
      onRestart={() => {
        setMode(null)
        setSessionKey((value) => value + 1)
      }}
    />
  )
}
