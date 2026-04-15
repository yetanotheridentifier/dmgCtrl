import { useState } from 'react'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import SwuHelpScreen from './components/swuHelpScreen'
import { Base } from './hooks/useBases'

type Screen = 'setup' | 'game' | 'help'

function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [previousScreen, setPreviousScreen] = useState<Screen>('setup')
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [useHyperspace, setUseHyperspace] = useState(false)

  const handleConfirm = (base: Base, hyperspace: boolean) => {
    setSelectedBase(base)
    setUseHyperspace(hyperspace)
    setScreen('game')
  }

  const handleBack = () => {
    setScreen('setup')
    setSelectedBase(null)
    setUseHyperspace(false)
  }

  const handleHelp = () => {
    setPreviousScreen(screen)
    setScreen('help')
  }

  const handleHelpBack = () => {
    setScreen(previousScreen)
  }

  if (screen === 'help') {
    return <SwuHelpScreen onBack={handleHelpBack} />
  }

  if (screen === 'setup') {
    return <SwuSetupScreen onConfirm={handleConfirm} onHelp={handleHelp} />
  }

  return <SwuGameScreen base={selectedBase!} onBack={handleBack} onHelp={handleHelp} useHyperspace={useHyperspace} />
}

export default App