import { useState } from 'react'
import SwuLoadingScreen from './components/swuLoadingScreen'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import SwuHelpScreen from './components/swuHelpScreen'
import SwuSettingsScreen from './components/swuSettingsScreen'
import { Base, useBases } from './hooks/useBases'
import { InitialSelection } from './hooks/useSwuSetup'

type Screen = 'loading' | 'setup' | 'game' | 'help' | 'settings'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [previousScreen, setPreviousScreen] = useState<Screen>('setup')
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)
  const { loading } = useBases()

  const handleReady = () => setScreen('setup')

  const handleConfirm = (base: Base) => {
    setSelectedBase(base)
    setLastSelection({ set: base.set, aspect: base.aspects[0] ?? 'None', key: `${base.set}-${base.number}` })
    setScreen('game')
  }

  const handleBack = () => setScreen('setup')

  const handleHelp = () => {
    setPreviousScreen(screen)
    setScreen('help')
  }

  const handleHelpBack = () => setScreen(previousScreen)

  const handleSettings = () => {
    setPreviousScreen(screen)
    setScreen('settings')
  }

  const handleSettingsBack = () => setScreen(previousScreen)

  if (screen === 'loading') {
    return <SwuLoadingScreen loading={loading} onReady={handleReady} />
  }

  if (screen === 'help') {
    return <SwuHelpScreen onBack={handleHelpBack} />
  }

  if (screen === 'settings') {
    return <SwuSettingsScreen onBack={handleSettingsBack} onHelp={handleHelp} />
  }

  if (screen === 'setup') {
    return (
      <SwuSetupScreen
        onConfirm={handleConfirm}
        onHelp={handleHelp}
        onSettings={handleSettings}
        initialSelection={lastSelection}
      />
    )
  }

  return (
    <SwuGameScreen
      base={selectedBase!}
      onBack={handleBack}
      onHelp={handleHelp}
      onSettings={handleSettings}
    />
  )
}

export default App
