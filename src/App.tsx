import { useState, useEffect, lazy, Suspense } from 'react'
import SwuLoadingScreen from './components/swuLoadingScreen'
import GameSelectScreen from './components/gameSelectScreen'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import { XwingListsProvider } from './hooks/useXwingLists'
import SwuTournamentScreen from './components/swuTournamentScreen'
import HelpScreen from './components/helpScreen'
import SettingsScreen from './components/settingsScreen'
import { Base, useBases } from './hooks/useBases'
import type { XwingMatchType, XwingScenario } from './hooks/useXwingSetup'
import type { XwingPilot } from './utils/parseXwsText'
import { useTournament } from './hooks/useTournament'
import { useUserSettings } from './hooks/useUserSettings'
import { onAppStart, onAppInstall, onAppResume, onTournamentRoundCompleted, onTournamentStarted } from './services/analytics'
import type { PlayMode, SetupMode } from './utils/playMode'
import type { TournamentSettings } from './hooks/useSwuSetup'
import { limitedBaseOptions } from './utils/formatFilter'

// The X-Wing screens carry the XWA card table, so they load as their own chunk on entering X-Wing
// rather than in the bundle every SWU player downloads. The service worker precaches the chunk, so
// X-Wing still works offline.
const XwingSetupScreen = lazy(() => import('./components/xwingSetupScreen'))
const XwingGameScreen = lazy(() => import('./components/xwingGameScreen'))
const XwingListsScreen = lazy(() => import('./components/xwingListsScreen'))

type Screen = 'loading' | 'gameSelect' | 'xwingSetup' | 'xwing' | 'xwingLists' | 'setup' | 'game' | 'tournament' | 'help' | 'settings'

function AppScreens() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [backStack, setBackStack] = useState<Screen[]>([])
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  // Two players: their base. Held for this session only, so a tournament resumed after a reload plays one-player.
  const [selectedTheirBase, setSelectedTheirBase] = useState<Base | null>(null)
  const [selectedPlayMode, setSelectedPlayMode] = useState<PlayMode>('casual')
  const [isInGame, setIsInGame] = useState(false)
  const [isInXwing, setIsInXwing] = useState(false)
  const [isInXwingSetup, setIsInXwingSetup] = useState(false)
  const [xwingPlayerDeficit, setXwingPlayerDeficit] = useState(0)
  const [xwingOpponentDeficit, setXwingOpponentDeficit] = useState(0)
  const [xwingScenario, setXwingScenario] = useState<XwingScenario>('None')
  const [xwingMatchType, setXwingMatchType] = useState<XwingMatchType>('Casual')
  const [xwingPlayerPilots, setXwingPlayerPilots] = useState<XwingPilot[]>([])
  const [xwingOpponentPilots, setXwingOpponentPilots] = useState<XwingPilot[]>([])
  const [tournamentCurrentBase, setTournamentCurrentBase] = useState<Base | null>(null)
  const [hasPlayedGameInCurrentMatch, setHasPlayedGameInCurrentMatch] = useState(false)
  const [helpSource, setHelpSource] = useState<'setup' | 'game' | 'tournament' | 'xwing' | 'xwingSetup' | 'xwingLists' | 'settings'>('setup')
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<'general' | 'swu' | 'xwing'>('swu')
  const { loading, bases } = useBases()
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

  // X-Wing setup stays mounted from here until Back to game select, so its choices survive
  // Squad Lists, Help, Settings and a game (a rematch is one tap).
  const enterXwingSetup = () => {
    setIsInXwingSetup(true)
    setScreen('xwingSetup')
  }

  const leaveXwingSetup = () => {
    setIsInXwingSetup(false)
    setScreen('gameSelect')
  }

  const handleReady = () => {
    if (tournament !== null) {
      setScreen('tournament')
      return
    }
    if (startScreen === 'xwing') {
      enterXwingSetup()
    } else if (startScreen === 'swu') {
      setScreen('setup')
    } else {
      setScreen('gameSelect')
    }
  }

  // Setup passes their base too in 2 players, which opens the two-player game screen.
  const handleConfirm = (base: Base, mode: SetupMode, theirBase?: Base) => {
    if (mode === 'tournament') {
      // Back to the tournament under way; a new one is started from the setup start sheet.
      if (tournament !== null) setScreen('tournament')
      return
    }
    setSelectedBase(base)
    setSelectedTheirBase(theirBase ?? null)
    setSelectedPlayMode('casual')
    setIsInGame(true)
    setScreen('game')
  }

  // Start round 1 goes straight to the game: the tournament and its first match start together.
  const handleStartTournament = (base: Base, { format, playMode, totalRounds }: TournamentSettings, theirBase?: Base) => {
    void onTournamentStarted(format, playMode, totalRounds)
    startTournament(base, format, playMode, totalRounds)
    startMatch()
    setSelectedBase(base)
    setSelectedTheirBase(theirBase ?? null)
    setTournamentCurrentBase(base)
    setHasPlayedGameInCurrentMatch(false)
    setSelectedPlayMode(playMode)
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
    const source: 'setup' | 'game' | 'tournament' | 'xwing' | 'xwingSetup' | 'xwingLists' | 'settings' =
      screen === 'game' ? 'game' :
      screen === 'tournament' ? 'tournament' :
      screen === 'xwing' ? 'xwing' :
      screen === 'xwingSetup' ? 'xwingSetup' :
      screen === 'xwingLists' ? 'xwingLists' :
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

  const handleXwingLists = () => {
    setBackStack(prev => [...prev, screen])
    setScreen('xwingLists')
  }

  const handleXwingStart = (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario, playerPilots: XwingPilot[], opponentPilots: XwingPilot[], matchType: XwingMatchType) => {
    setXwingMatchType(matchType)
    setXwingPlayerDeficit(playerDeficit)
    setXwingOpponentDeficit(opponentDeficit)
    setXwingScenario(scenario)
    setXwingPlayerPilots(playerPilots)
    setXwingOpponentPilots(opponentPilots)
    setIsInXwing(true)
    setScreen('xwing')
  }

  const handleXwingBack = () => {
    setIsInXwing(false)
    enterXwingSetup()
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
        onSelectXwing={enterXwingSetup}
        onSettings={handleSettings}
      />
    )
  }

  if (screen === 'setup') {
    return (
      <SwuSetupScreen
        onConfirm={handleConfirm}
        onStartTournament={handleStartTournament}
        tournamentInProgress={tournament !== null}
        onHelp={handleHelp}
        onBack={() => setScreen('gameSelect')}
        onSettings={handleSettings}
      />
    )
  }

  // Keep game and X-Wing setup screens mounted while navigating to help/settings/tournament so game state is preserved.
  // Use tournament.base as fallback when selectedBase is null (e.g. app resumed into an active tournament).
  const gameBase = tournamentCurrentBase ?? selectedBase ?? tournament?.base ?? null
  // In Limited best of 3 the base can change between games, from the game screen's More menu.
  const limitedBo3 = tournament !== null && tournament.format === 'limited' && tournament.playMode === 'bo3'

  return (
    <>
      <Suspense fallback={null}>
        {isInXwingSetup && (
          <div style={screen === 'xwingSetup' ? undefined : { display: 'none' }}>
            <XwingSetupScreen
              onStart={handleXwingStart}
              onBack={leaveXwingSetup}
              onHelp={handleHelp}
              onSettings={handleSettings}
              onLists={handleXwingLists}
            />
          </div>
        )}
        {screen === 'xwingLists' && <XwingListsScreen onBack={handleOverlayBack} onHelp={handleHelp} />}
        {isInXwing && (
          <div style={screen === 'xwing' ? undefined : { display: 'none' }}>
            <XwingGameScreen
              onBack={handleXwingBack}
              onHelp={handleHelp}
              onSettings={handleSettings}
              playerDeficit={xwingPlayerDeficit}
              opponentDeficit={xwingOpponentDeficit}
              scenario={xwingScenario}
              matchType={xwingMatchType}
              playerPilots={xwingPlayerPilots}
              opponentPilots={xwingOpponentPilots}
            />
          </div>
        )}
      </Suspense>
      {isInGame && gameBase && (
        <div style={screen === 'game' ? undefined : { display: 'none' }}>
          <SwuGameScreen
            base={gameBase}
            theirBase={selectedTheirBase ?? undefined}
            playMode={selectedPlayMode}
            format={tournament?.format}
            isInTournament={tournament !== null}
            onBack={handleBack}
            onHelp={handleHelp}
            onSettings={handleSettings}
            onMatchComplete={handleMatchComplete}
            changeBaseOptions={limitedBo3 && tournament ? limitedBaseOptions(bases, tournament.base) : undefined}
            onChangeBase={limitedBo3 ? setTournamentCurrentBase : undefined}
          />
        </div>
      )}
      {screen === 'tournament' && tournament && (
        <SwuTournamentScreen
          tournament={tournament}
          matchInProgress={matchInProgress}
          isComplete={isComplete}
          totals={totals}
          points={points}
          hasPlayedGameInCurrentMatch={hasPlayedGameInCurrentMatch}
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
      {screen === 'settings' && <SettingsScreen onBack={handleOverlayBack} onHelp={handleHelp} onManageXwingLists={handleXwingLists} defaultTab={settingsDefaultTab} />}
    </>
  )
}

// The lists provider sits here, not in main.tsx, so every screen App renders (and App's tests) has it.
function App() {
  return (
    <XwingListsProvider>
      <AppScreens />
    </XwingListsProvider>
  )
}

export default App
