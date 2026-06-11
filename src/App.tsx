import { useState, useEffect } from 'react'
import SwuLoadingScreen from './components/swuLoadingScreen'
import GameSelectScreen from './components/gameSelectScreen'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import XwingGameScreen from './components/xwingGameScreen'
import XwingSetupScreen from './components/xwingSetupScreen'
import SwuTournamentScreen from './components/swuTournamentScreen'
import HelpScreen from './components/helpScreen'
import SettingsScreen from './components/settingsScreen'
import { Base, useBases } from './hooks/useBases'
import { InitialSelection } from './hooks/useSwuSetup'
import type { XwingScenario } from './hooks/useXwingSetup'
import { useTournament } from './hooks/useTournament'
import { useUserSettings } from './hooks/useUserSettings'
import { onAppStart, onAppInstall, onAppResume, onTournamentRoundCompleted } from './services/analytics'
import type { PlayMode, SetupMode } from './utils/playMode'
import type { Format } from './utils/formatFilter'

type Screen = 'loading' | 'gameSelect' | 'xwingSetup' | 'xwing' | 'setup' | 'game' | 'tournament' | 'help' | 'settings'

function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [backStack, setBackStack] = useState<Screen[]>([])
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  const [selectedPlayMode, setSelectedPlayMode] = useState<PlayMode>('casual')
  const [selectedFormat, setSelectedFormat] = useState<Format>('premier')
  const [lastSelection, setLastSelection] = useState<InitialSelection | null>(null)
  const [isInGame, setIsInGame] = useState(false)
  const [isInXwing, setIsInXwing] = useState(false)
  const [xwingPlayerDeficit, setXwingPlayerDeficit] = useState(0)
  const [xwingOpponentDeficit, setXwingOpponentDeficit] = useState(0)
  const [xwingScenario, setXwingScenario] = useState<XwingScenario>('None')
  const [tournamentCurrentBase, setTournamentCurrentBase] = useState<Base | null>(null)
  const [hasPlayedGameInCurrentMatch, setHasPlayedGameInCurrentMatch] = useState(false)
  const [helpSource, setHelpSource] = useState<'setup' | 'game' | 'tournament' | 'xwing' | 'xwingSetup' | 'settings'>('setup')
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<'general' | 'swu' | 'xwing'>('swu')
  const { loading } = useBases()
  const { startScreen } = useUserSettings()
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
      return
    }
    if (startScreen === 'xwing') {
      setScreen('xwingSetup')
    } else if (startScreen === 'swu') {
      setScreen('setup')
    } else {
      setScreen('gameSelect')
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
  }

  const handleGoToGame = (playMode: 'bo1' | 'bo3', newBase?: Base) => {
    if (newBase) setTournamentCurrentBase(newBase)
    // matchInProgress is false when starting game 1 of any match (React state not yet updated
    // from startMatch() in the same handler); true when continuing mid-match for game 2/3.
    if (!matchInProgress) setHasPlayedGameInCurrentMatch(false)
    setSelectedPlayMode(playMode)
    setIsInGame(true)
    setScreen('game')
  }

  const handleMatchComplete = (result: 'won' | 'lost' | 'drawn', playerScore: number, opponentScore: number) => {
    const roundNumber = (tournament?.rounds.length ?? 0)
    void onTournamentRoundCompleted(roundNumber, result, playerScore, opponentScore, tournament?.format ?? '', selectedPlayMode)
    completeMatch(result, playerScore, opponentScore)
    setHasPlayedGameInCurrentMatch(false)
    setIsInGame(false)
    setScreen('tournament')
  }

  const handleBack = (gamesCompleted = 0) => {
    if (tournament !== null) {
      if (matchInProgress) setHasPlayedGameInCurrentMatch(gamesCompleted > 0)
      setScreen('tournament')
      return
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
    const source: 'setup' | 'game' | 'tournament' | 'xwing' | 'xwingSetup' | 'settings' =
      screen === 'game' ? 'game' :
      screen === 'tournament' ? 'tournament' :
      screen === 'xwing' ? 'xwing' :
      screen === 'xwingSetup' ? 'xwingSetup' :
      screen === 'settings' ? 'settings' :
      'setup'
    setHelpSource(source)
    setBackStack(prev => [...prev, screen])
    setScreen('help')
  }

  const handleSettings = () => {
    const tab: 'general' | 'swu' | 'xwing' =
      screen === 'gameSelect' ? 'general' :
      screen === 'xwing' || screen === 'xwingSetup' ? 'xwing' :
      'swu'
    setSettingsDefaultTab(tab)
    setBackStack(prev => [...prev, screen])
    setScreen('settings')
  }

  const handleXwingStart = (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario) => {
    setXwingPlayerDeficit(playerDeficit)
    setXwingOpponentDeficit(opponentDeficit)
    setXwingScenario(scenario)
    setIsInXwing(true)
    setScreen('xwing')
  }

  const handleXwingBack = () => {
    setIsInXwing(false)
    setScreen('xwingSetup')
  }

  const handleOverlayBack = () => {
    const target = backStack[backStack.length - 1] ?? 'setup'
    setBackStack(prev => prev.slice(0, -1))
    setScreen(target)
  }

  if (screen === 'loading') {
    return <SwuLoadingScreen loading={loading} onReady={handleReady} />
  }

  if (screen === 'gameSelect') {
    return (
      <GameSelectScreen
        onSelectSwu={() => setScreen('setup')}
        onSelectXwing={() => setScreen('xwingSetup')}
        onSettings={handleSettings}
      />
    )
  }

  if (screen === 'xwingSetup') {
    return (
      <XwingSetupScreen
        onStart={handleXwingStart}
        onBack={() => setScreen('gameSelect')}
        onHelp={handleHelp}
        onSettings={handleSettings}
      />
    )
  }

  if (screen === 'setup') {
    return (
      <SwuSetupScreen
        onConfirm={handleConfirm}
        onHelp={handleHelp}
        onBack={() => setScreen('gameSelect')}
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
      {isInXwing && (
        <div style={screen === 'xwing' ? undefined : { display: 'none' }}>
          <XwingGameScreen
            onBack={handleXwingBack}
            onHelp={handleHelp}
            onSettings={handleSettings}
            playerDeficit={xwingPlayerDeficit}
            opponentDeficit={xwingOpponentDeficit}
            scenario={xwingScenario}
          />
        </div>
      )}
      {isInGame && gameBase && (
        <div style={screen === 'game' ? undefined : { display: 'none' }}>
          <SwuGameScreen
            base={gameBase}
            playMode={selectedPlayMode}
            format={selectedFormat}
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
      {screen === 'help' && <HelpScreen onBack={handleOverlayBack} source={helpSource} />}
      {screen === 'settings' && <SettingsScreen onBack={handleOverlayBack} onHelp={handleHelp} defaultTab={settingsDefaultTab} />}
    </>
  )
}

export default App
