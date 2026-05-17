import { useState, useEffect, useRef } from 'react'
import SwuLoadingScreen from './components/swuLoadingScreen'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import SwuHelpScreen from './components/swuHelpScreen'
import SwuSettingsScreen from './components/swuSettingsScreen'
import { Base, useBases } from './hooks/useBases'
import { InitialSelection } from './hooks/useSwuSetup'
import { useUserSettings } from './hooks/useUserSettings'
import { onAppStart, onGameStart, onGameEnd, onAppInstall, onAppResume } from './services/analytics'
import type { PlayMode, SetupMode } from './utils/playMode'

type Screen = 'loading' | 'setup' | 'game' | 'help' | 'settings'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [backStack, setBackStack] = useState<Screen[]>([])
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [selectedPlayMode, setSelectedPlayMode] = useState<PlayMode>('casual')
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)
  const [isInGame, setIsInGame] = useState(false)
  const [helpSource, setHelpSource] = useState<'setup' | 'game'>('setup')
  const { loading } = useBases()
  const { useHyperspace } = useUserSettings()
  const gameStartTime = useRef<number>(0)

  useEffect(() => { void onAppStart() }, [])

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (isStandalone && !localStorage.getItem('pwa_install_tracked')) {
      localStorage.setItem('pwa_install_tracked', '1')
      const navStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
      const platform = navStandalone === true ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'other'
      void onAppInstall(platform)
    }
  }, [])

  useEffect(() => {
    let hasBeenHidden = false
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hasBeenHidden = true
      } else if (document.visibilityState === 'visible' && hasBeenHidden) {
        void onAppResume()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const handleReady = () => setScreen('setup')

  const handleConfirm = (base: Base, mode: SetupMode) => {
    if (mode === 'tournament') {
      // Tournament screen wired in #205
      return
    }
    setSelectedBase(base)
    setSelectedPlayMode('casual')
    setLastSelection({ set: base.set, aspect: base.aspects[0] ?? 'None', key: `${base.set}-${base.number}` })
    setIsInGame(true)
    setScreen('game')
    gameStartTime.current = Date.now()
    void onGameStart(`${base.set}-${base.number}`, base.set, useHyperspace, 'casual')
  }

  const handleBack = () => {
    if (selectedBase) {
      const durationSeconds = Math.round((Date.now() - gameStartTime.current) / 1000)
      void onGameEnd(`${selectedBase.set}-${selectedBase.number}`, selectedBase.set, useHyperspace, durationSeconds, selectedPlayMode)
    }
    setIsInGame(false)
    setScreen('setup')
  }

  const handleHelp = () => {
    const source: 'setup' | 'game' =
      screen === 'game' ? 'game' :
      screen === 'settings' && backStack[backStack.length - 1] === 'game' ? 'game' :
      'setup'
    setHelpSource(source)
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
            playMode={selectedPlayMode}
            onBack={handleBack}
            onHelp={handleHelp}
            onSettings={handleSettings}
          />
        </div>
      )}
      {screen === 'help' && <SwuHelpScreen onBack={handleOverlayBack} source={helpSource} />}
      {screen === 'settings' && <SwuSettingsScreen onBack={handleOverlayBack} onHelp={handleHelp} />}
    </>
  )
}

export default App
