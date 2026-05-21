import { useState, useEffect, useRef } from 'react'
import SwuLoadingScreen from './components/swuLoadingScreen'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import SwuTournamentScreen from './components/swuTournamentScreen'
import SwuHelpScreen from './components/swuHelpScreen'
import SwuSettingsScreen from './components/swuSettingsScreen'
import { Base, useBases } from './hooks/useBases'
import { InitialSelection } from './hooks/useSwuSetup'
import { useTournament } from './hooks/useTournament'
import { useUserSettings } from './hooks/useUserSettings'
import { onAppStart, onGameStart, onGameEnd, onAppInstall, onAppResume, onTournamentRoundCompleted } from './services/analytics'
import type { PlayMode, SetupMode } from './utils/playMode'
import type { Format } from './utils/formatFilter'

type Screen = 'loading' | 'setup' | 'game' | 'tournament' | 'help' | 'settings'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [backStack, setBackStack] = useState<Screen[]>([])
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [selectedPlayMode, setSelectedPlayMode] = useState<PlayMode>('casual')
  const [selectedFormat, setSelectedFormat] = useState<Format>('premier')
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)
  const [isInGame, setIsInGame] = useState(false)
  const [tournamentCurrentBase, setTournamentCurrentBase] = useState<Base | null>(null)
  const [hasPlayedGameInCurrentMatch, setHasPlayedGameInCurrentMatch] = useState(false)
  const [helpSource, setHelpSource] = useState<'setup' | 'game' | 'tournament'>('setup')
  const { loading } = useBases()
  const { useHyperspace } = useUserSettings()
  const gameStartTime = useRef<number>(0)
  const {
    tournament,
    matchInProgress,
    isComplete,
    totals,
    points,
    startTournament,
    startMatch,
    completeMatch,
    dropTournament,
  } = useTournament()

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

  const handleReady = () => {
    if (tournament !== null) {
      setScreen('tournament')
    } else {
      setScreen('setup')
    }
  }

  const handleConfirm = (base: Base, mode: SetupMode, format: Format) => {
    if (mode === 'tournament') {
      setSelectedBase(base)
      setSelectedFormat(format)
      setScreen('tournament')
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

  const handleGoToGame = (playMode: 'bo1' | 'bo3', newBase?: Base) => {
    if (newBase) setTournamentCurrentBase(newBase)
    const base = newBase ?? tournamentCurrentBase ?? selectedBase ?? tournament?.base
    // matchInProgress is false when starting game 1 of any match (React state not yet updated
    // from startMatch() in the same handler); true when continuing mid-match for game 2/3.
    if (!matchInProgress) setHasPlayedGameInCurrentMatch(false)
    setSelectedPlayMode(playMode)
    setIsInGame(true)
    setScreen('game')
    gameStartTime.current = Date.now()
    if (base) {
      void onGameStart(`${base.set}-${base.number}`, base.set, useHyperspace, playMode)
    }
  }

  const handleMatchComplete = (result: 'won' | 'lost' | 'drawn', playerScore: number, opponentScore: number) => {
    const base = selectedBase ?? tournament?.base
    if (base) {
      const durationSeconds = Math.round((Date.now() - gameStartTime.current) / 1000)
      void onGameEnd(`${base.set}-${base.number}`, base.set, useHyperspace, durationSeconds, selectedPlayMode)
    }
    const roundNumber = (tournament?.rounds.length ?? 0)
    void onTournamentRoundCompleted(roundNumber, result, playerScore, opponentScore, tournament?.format ?? '', selectedPlayMode)
    completeMatch(result, playerScore, opponentScore)
    setHasPlayedGameInCurrentMatch(false)
    setIsInGame(false)
    setScreen('tournament')
  }

  const handleBack = (gamesCompleted = 0) => {
    if (tournament !== null) {
      const base = selectedBase ?? tournament.base
      if (base) {
        const durationSeconds = Math.round((Date.now() - gameStartTime.current) / 1000)
        void onGameEnd(`${base.set}-${base.number}`, base.set, useHyperspace, durationSeconds, selectedPlayMode)
      }
      if (matchInProgress) setHasPlayedGameInCurrentMatch(gamesCompleted > 0)
      setScreen('tournament')
      return
    }
    if (selectedBase) {
      const durationSeconds = Math.round((Date.now() - gameStartTime.current) / 1000)
      void onGameEnd(`${selectedBase.set}-${selectedBase.number}`, selectedBase.set, useHyperspace, durationSeconds, selectedPlayMode)
    }
    setIsInGame(false)
    setScreen('setup')
  }

  const handleTournamentDrop = () => {
    setTournamentCurrentBase(null)
    setHasPlayedGameInCurrentMatch(false)
    setIsInGame(false)
    setScreen('setup')
  }

  const handleHelp = () => {
    const source: 'setup' | 'game' | 'tournament' =
      screen === 'game' ? 'game' :
      screen === 'settings' && backStack[backStack.length - 1] === 'game' ? 'game' :
      screen === 'tournament' ? 'tournament' :
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

  // Keep game screen mounted while navigating to help/settings/tournament so game state is preserved.
  // Use tournament.base as fallback when selectedBase is null (e.g. app resumed into an active tournament).
  const gameBase = tournamentCurrentBase ?? selectedBase ?? tournament?.base ?? null
  const tournamentBase = tournament?.base ?? selectedBase ?? null

  return (
    <>
      {isInGame && gameBase && (
        <div style={screen === 'game' ? undefined : { display: 'none' }}>
          <SwuGameScreen
            base={gameBase}
            playMode={selectedPlayMode}
            isInTournament={tournament !== null}
            onBack={handleBack}
            onHelp={handleHelp}
            onSettings={handleSettings}
            onMatchComplete={handleMatchComplete}
          />
        </div>
      )}
      {screen === 'tournament' && tournamentBase && (
        <SwuTournamentScreen
          base={tournamentBase}
          format={selectedFormat}
          tournament={tournament}
          matchInProgress={matchInProgress}
          isComplete={isComplete}
          totals={totals}
          points={points}
          hasPlayedGameInCurrentMatch={hasPlayedGameInCurrentMatch}
          startTournament={startTournament}
          startMatch={startMatch}
          dropTournament={dropTournament}
          onGoToGame={handleGoToGame}
          onDrop={handleTournamentDrop}
          onBack={() => setScreen('setup')}
          onHelp={handleHelp}
          onSettings={handleSettings}
        />
      )}
      {screen === 'help' && <SwuHelpScreen onBack={handleOverlayBack} source={helpSource} />}
      {screen === 'settings' && <SwuSettingsScreen onBack={handleOverlayBack} onHelp={handleHelp} />}
    </>
  )
}

export default App
