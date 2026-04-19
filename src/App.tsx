import { useState } from 'react'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import SwuHelpScreen from './components/swuHelpScreen'
import { Base } from './hooks/useBases'
import { InitialSelection } from './hooks/useSwuSetup'

type Screen = 'setup' | 'game' | 'help'

function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [previousScreen, setPreviousScreen] = useState<Screen>('setup')
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [useHyperspace, setUseHyperspace] = useState(false)
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)

  const handleConfirm = (base: Base, hyperspace: boolean) => {
    setSelectedBase(base)
    setUseHyperspace(hyperspace)
    setLastSelection({ set: base.set, aspect: base.aspects[0] ?? 'None', key: `${base.set}-${base.number}` })
    setScreen('game')
  }

  const handleBack = () => {
    setScreen('setup')
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
    return <SwuSetupScreen onConfirm={handleConfirm} onHelp={handleHelp} initialSelection={lastSelection} />
  }

  return <SwuGameScreen base={selectedBase!} onBack={handleBack} onHelp={handleHelp} useHyperspace={useHyperspace} />
}

export default App