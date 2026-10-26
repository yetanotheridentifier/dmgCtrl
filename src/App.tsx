import { useState, useEffect, lazy, Suspense } from 'react'
import { SwuSplash, SwuOffline } from './components/swuCardDataScreens'
import GameSelectScreen from './components/gameSelectScreen'
import InstallBanner from './components/installBanner'
import { useInstallPrompt } from './hooks/useInstallPrompt'
import { gameFromPath, launchScreen, readLastGame, recordLastGame } from './utils/appStart'
import SwuSetupScreen from './components/swuSetupScreen'
import SwuGameScreen from './components/swuGameScreen'
import { XwingListsProvider } from './hooks/useXwingLists'
import SwuTournamentScreen from './components/swuTournamentScreen'
import HelpScreen, { type HelpSource } from './components/helpScreen'
import SettingsScreen from './components/settingsScreen'
import { Base, useBases } from './hooks/useBases'
import type { XwingMatchType, XwingScenario } from './hooks/useXwingSetup'
import type { XwingPilot } from './utils/parseXwsText'
import { useTournament } from './hooks/useTournament'
import { useXwingTournament, type XwingRoundResult, type XwingTournamentList } from './hooks/useXwingTournament'
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
const XwingTournamentScreen = lazy(() => import('./components/xwingTournamentScreen'))

type Screen = 'gameSelect' | 'xwingSetup' | 'xwing' | 'xwingLists' | 'xwingTournament' | 'setup' | 'game' | 'tournament' | 'help' | 'settings'

// The install banner shows only on these: never over a game.
const BANNER_SCREENS: Screen[] = ['gameSelect', 'setup', 'xwingSetup']

function AppScreens() {
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
  const xwingTournament = useXwingTournament()
  // Where the app opens is settled once, at launch. SWU setup that has no card data yet shows the
  // splash or the offline screen in its place (below), so nothing else waits for SWU card data.
  const [screen, setScreen] = useState<Screen>(() => launchScreen({
    tournamentInProgress: tournament !== null,
    xwingTournamentInProgress: xwingTournament.tournament !== null,
    route: gameFromPath(window.location.pathname, import.meta.env.BASE_URL),
    startScreen,
    lastGame: readLastGame(),
  }))
  const [backStack, setBackStack] = useState<Screen[]>([])
  const [selectedBase, setSelectedBase] = useState<Base | null>(null)
  // Two players: their base. Held for this session only, so a tournament resumed after a reload plays one-player.
  const [selectedTheirBase, setSelectedTheirBase] = useState<Base | null>(null)
  const [selectedPlayMode, setSelectedPlayMode] = useState<PlayMode>('casual')
  const [isInGame, setIsInGame] = useState(false)
  const [isInXwing, setIsInXwing] = useState(false)
  const [isInXwingSetup, setIsInXwingSetup] = useState(screen === 'xwingSetup')
  const [xwingPlayerDeficit, setXwingPlayerDeficit] = useState(0)
  const [xwingOpponentDeficit, setXwingOpponentDeficit] = useState(0)
  const [xwingScenario, setXwingScenario] = useState<XwingScenario>('None')
  const [xwingMatchType, setXwingMatchType] = useState<XwingMatchType>('Casual')
  const [xwingPlayerPilots, setXwingPlayerPilots] = useState<XwingPilot[]>([])
  const [xwingOpponentPilots, setXwingOpponentPilots] = useState<XwingPilot[]>([])
  // Each game started is a fresh game screen, whatever was mounted before it.
  const [xwingGameKey, setXwingGameKey] = useState(0)
  const [isXwingTournamentGame, setIsXwingTournamentGame] = useState(false)
  const [tournamentCurrentBase, setTournamentCurrentBase] = useState<Base | null>(null)
  const [hasPlayedGameInCurrentMatch, setHasPlayedGameInCurrentMatch] = useState(false)
  const [helpSource, setHelpSource] = useState<HelpSource>('setup')
  const { loading, bases, error: basesError, retry: retryBases } = useBases()
  const install = useInstallPrompt()

  useEffect(() => { void onAppStart() }, [])

  // A game counts as played once its setup opens.
  useEffect(() => {
    if (screen === 'setup') recordLastGame('swu')
    if (screen === 'xwingSetup') recordLastGame('xwing')
  }, [screen])

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

  // Setup passes their base too in 2 players, which opens the two-player game screen. In Twin Suns it
  // also passes the opponents' seats, not used yet: the game opens with your base alone.
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
    const source: HelpSource =
      screen === 'gameSelect' ? 'gameSelect' :
      screen === 'game' ? 'game' :
      screen === 'tournament' ? 'tournament' :
      screen === 'xwing' ? 'xwing' :
      screen === 'xwingSetup' ? 'xwingSetup' :
      screen === 'xwingLists' ? 'xwingLists' :
      screen === 'xwingTournament' ? 'xwingTournament' :
      'setup'
    setHelpSource(source)
    setBackStack(prev => [...prev, screen])
    setScreen('help')
  }

  const handleSettings = () => {
    setBackStack(prev => [...prev, screen])
    setScreen('settings')
  }

  const handleXwingLists = () => {
    setBackStack(prev => [...prev, screen])
    setScreen('xwingLists')
  }

  const handleXwingStart = (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario, playerPilots: XwingPilot[], opponentPilots: XwingPilot[], matchType: XwingMatchType, inTournament = false) => {
    setXwingMatchType(matchType)
    setXwingPlayerDeficit(playerDeficit)
    setXwingOpponentDeficit(opponentDeficit)
    setXwingScenario(scenario)
    setXwingPlayerPilots(playerPilots)
    setXwingOpponentPilots(opponentPilots)
    setIsXwingTournamentGame(inTournament)
    setXwingGameKey(k => k + 1)
    setIsInXwing(true)
    setScreen('xwing')
  }

  const handleXwingBack = () => {
    setIsInXwing(false)
    enterXwingSetup()
  }

  // A tournament round's game: your list for the tournament against the round's opponent.
  const playXwingRound = (player: XwingTournamentList, opponent: XwingTournamentList, scenario: XwingScenario) => {
    handleXwingStart(player.deficit, opponent.deficit, scenario, player.pilots, opponent.pilots, 'Tournament', true)
  }

  // Start round 1 goes straight to the game: the tournament and its first round start together.
  const handleXwingStartTournament = (totalRounds: number, scenario: XwingScenario, player: XwingTournamentList, opponent: XwingTournamentList) => {
    xwingTournament.startTournament(totalRounds, scenario, player, opponent)
    playXwingRound(player, opponent, scenario)
  }

  const handleXwingNextRound = (opponent: XwingTournamentList) => {
    const t = xwingTournament.tournament
    if (!t) return
    xwingTournament.startRound(opponent)
    playXwingRound(t.player, opponent, t.scenario)
  }

  // The game is still mounted unless the app was closed mid-round; then the round starts afresh.
  const handleXwingReturnToRound = () => {
    const t = xwingTournament.tournament
    if (isInXwing && isXwingTournamentGame) {
      setScreen('xwing')
    } else if (t && t.rounds.length > 0) {
      playXwingRound(t.player, t.rounds[t.rounds.length - 1].opponent, t.scenario)
    }
  }

  const handleXwingRoundComplete = (result: XwingRoundResult, playerScore: number, opponentScore: number) => {
    xwingTournament.completeRound(result, playerScore, opponentScore)
    setIsInXwing(false)
    setScreen('xwingTournament')
  }

  // Drop and Finish both clear the tournament and return to setup.
  const handleXwingTournamentEnd = () => {
    xwingTournament.dropTournament()
    setIsInXwing(false)
    enterXwingSetup()
  }

  const handleOverlayBack = () => {
    const target = backStack[backStack.length - 1] ?? 'setup'
    setBackStack(prev => prev.slice(0, -1))
    setScreen(target)
  }

  const banner = install.showBanner && install.platform && BANNER_SCREENS.includes(screen)
    ? <InstallBanner platform={install.platform} onInstall={install.onInstall} onDismiss={install.onDismiss} />
    : null
  // Over a setup screen the banner floats at the foot; game select makes room for it under its tiles.
  const floatingBanner = banner && (
    <div style={{ position: 'fixed', left: 'calc(16px + env(safe-area-inset-left))', right: 'calc(16px + env(safe-area-inset-right))', bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 200 }}>
      {banner}
    </div>
  )

  if (screen === 'gameSelect') {
    return (
      <GameSelectScreen
        lastGame={readLastGame()}
        onSelectSwu={() => setScreen('setup')}
        onSelectXwing={enterXwingSetup}
        onHelp={handleHelp}
        onSettings={handleSettings}
        banner={banner}
      />
    )
  }

  if (screen === 'setup') {
    // SWU setup needs card data: none yet means the splash while it loads, or the offline screen.
    if (bases.length === 0 && loading) return <SwuSplash />
    if (bases.length === 0 && basesError) {
      return <SwuOffline onRetry={retryBases} onPlayXwing={enterXwingSetup} onBack={() => setScreen('gameSelect')} />
    }
    return (
      <>
        <SwuSetupScreen
          onConfirm={handleConfirm}
          onStartTournament={handleStartTournament}
          tournamentInProgress={tournament !== null}
          onHelp={handleHelp}
          onBack={() => setScreen('gameSelect')}
          onSettings={handleSettings}
        />
        {floatingBanner}
      </>
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
              tournamentInProgress={xwingTournament.tournament !== null}
              onStartTournament={handleXwingStartTournament}
              onGoToTournament={() => setScreen('xwingTournament')}
            />
            {floatingBanner}
          </div>
        )}
        {screen === 'xwingLists' && <XwingListsScreen onBack={handleOverlayBack} onHelp={handleHelp} />}
        {isInXwing && (
          <div style={screen === 'xwing' ? undefined : { display: 'none' }}>
            <XwingGameScreen
              key={xwingGameKey}
              onBack={isXwingTournamentGame ? () => setScreen('xwingTournament') : handleXwingBack}
              onRoundComplete={isXwingTournamentGame ? handleXwingRoundComplete : undefined}
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
        {screen === 'xwingTournament' && xwingTournament.tournament && (
          <XwingTournamentScreen
            tournament={xwingTournament.tournament}
            roundInProgress={xwingTournament.roundInProgress}
            isComplete={xwingTournament.isComplete}
            totals={xwingTournament.totals}
            margin={xwingTournament.margin}
            onStartRound={handleXwingNextRound}
            onReturnToRound={handleXwingReturnToRound}
            onDrop={handleXwingTournamentEnd}
            onFinish={handleXwingTournamentEnd}
            onBack={enterXwingSetup}
            onHelp={handleHelp}
            onSettings={handleSettings}
            onLists={handleXwingLists}
          />
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
      {screen === 'settings' && <SettingsScreen onBack={handleOverlayBack} onManageXwingLists={handleXwingLists} />}
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
