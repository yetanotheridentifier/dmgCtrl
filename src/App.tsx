import { useState } from 'react'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'

type Screen = 'setup' | 'game'

function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [startingHealth, setStartingHealth] = useState<number>(0)

  const handleConfirm = (health: number) => {
    setStartingHealth(health)
    setScreen('game')
  }

  const handleBack = () => {
    setScreen('setup')
    setStartingHealth(0)
  }

  if (screen === 'setup') {
    return <SwuSetupScreen onConfirm={handleConfirm} />
  }

  return <SwuGameScreen startingHealth={startingHealth} onBack={handleBack} />
}

export default App