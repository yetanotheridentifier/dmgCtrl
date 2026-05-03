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
  const [backStack, setBackStack] = useState<Screen[]>([])
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)
  const [isInGame, setIsInGame] = useState(false)
  const { loading } = useBases()

  const handleReady = () => setScreen('setup')

  const handleConfirm = (base: Base) => {
    setSelectedBase(base)
    setLastSelection({ set: base.set, aspect: base.aspects[0] ?? 'None', key: `${base.set}-${base.number}` })
    setIsInGame(true)
    setScreen('game')
  }

  const handleBack = () => {
    setIsInGame(false)
    setScreen('setup')
  }

  const handleHelp = () => {
    setBackStack(prev => [...prev, screen])
    setScreen('help')
  }

  const handleSettings = () => {
    setBackStack(prev => [...prev, screen])
    setScreen('settings')
  }

  const handleOverlayBack = () => {
    const target = backStack[backStack.length - 1] ?? 'setup'
    setBackStack(prev => prev.slice(0, -1))
    setScreen(target)
  }

  if (screen === 'loading') {
    return <SwuLoadingScreen loading={loading} onReady={handleReady} />
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

  // Keep game screen mounted while navigating to help/settings so game state is preserved
  return (
    <>
      {isInGame && selectedBase && (
        <div style={screen === 'game' ? undefined : { display: 'none' }}>
          <SwuGameScreen
            base={selectedBase}
            onBack={handleBack}
            onHelp={handleHelp}
            onSettings={handleSettings}
          />
        </div>
      )}
      {screen === 'help' && <SwuHelpScreen onBack={handleOverlayBack} />}
      {screen === 'settings' && <SwuSettingsScreen onBack={handleOverlayBack} onHelp={handleHelp} />}
    </>
  )
}

export default App
