import { useState } from 'react'
import SwuLoadingScreen from './components/swuLoadingScreen'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import SwuHelpScreen from './components/swuHelpScreen'
import { Base, useBases } from './hooks/useBases'
import { InitialSelection } from './hooks/useSwuSetup'

type Screen = 'loading' | 'setup' | 'game' | 'help'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [previousScreen, setPreviousScreen] = useState<Screen>('setup')
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [useHyperspace, setUseHyperspace] = useState(false)
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)
  const { loading } = useBases()

  const handleReady = () => setScreen('setup')

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

  if (screen === 'loading') {
    return <SwuLoadingScreen loading={loading} onReady={handleReady} />
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