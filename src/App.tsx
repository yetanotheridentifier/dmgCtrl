import { useState } from 'react'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import { Base } from './hooks/useBases'

type Screen = 'setup' | 'game'

function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)

  const handleConfirm = (base: Base) => {
    setSelectedBase(base)
    setScreen('game')
  }

  const handleBack = () => {
    setScreen('setup')
    setSelectedBase(null)
  }

  if (screen === 'setup') {
    return <SwuSetupScreen onConfirm={handleConfirm} />
  }

  return <SwuGameScreen base={selectedBase!} onBack={handleBack} />
}

export default App