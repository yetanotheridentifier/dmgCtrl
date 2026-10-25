import { useState, useRef, useEffect } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useUserSettings } from '../hooks/useUserSettings'
import { useXwingGame, reachesTarget } from '../hooks/useXwingGame'
import { useGameHistory } from '../hooks/useGameHistory'
import { useTimer } from '../hooks/useTimer'
import { useWakeLock } from '../hooks/useWakeLock'
import { useInitiative } from '../hooks/useInitiative'
import { usePhaseTracker, XWING_PHASES } from '../hooks/usePhaseTracker'
import XwingGameScreenView, { type ScoreBreakdown, type GameOverReason } from './xwingGameScreenView'
import RotatePrompt from './layout/rotatePrompt'
import { onXwingGameStarted, onXwingGameEnded, onXwingRoundAdvanced } from '../services/analytics'
import type { XwingMatchType, XwingScenario } from '../hooks/useXwingSetup'
import type { XwingPilot } from '../utils/parseXwsText'
import { type ShipEntry, initShips, halfPoints, remainingPoints } from '../utils/shipRoster'
import { displayPilots } from '../utils/displayPilots'

interface XwingGameSnapshot {
  playerScore: number
  opponentScore: number
  playerScenarioScore: number
  opponentScenarioScore: number
  round: number
  gameStarted: boolean
  phaseIndex: number
  gameOver: boolean
  playerShips: ShipEntry[]
  opponentShips: ShipEntry[]
  scoringOpen: boolean
  extraRound: boolean
  gameOverReason: GameOverReason | null
}

interface Props {
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onTimerExpired?: () => void
  playerDeficit?: number
  opponentDeficit?: number
  scenario?: XwingScenario
  matchType?: XwingMatchType
  playerPilots?: XwingPilot[]
  opponentPilots?: XwingPilot[]
}

// Points scored against a side's ships: half for a damaged ship, all for a destroyed one.
const shipPointsAgainst = (ships: ShipEntry[]) =>
  ships.reduce((sum, s) => sum + (s.state === 'half' ? halfPoints(s.pilot.points) : s.state === 'destroyed' ? s.pilot.points : 0), 0)

const allDestroyed = (ships: ShipEntry[]) => ships.length > 0 && ships.every(s => s.state === 'destroyed')

export default function XwingGameScreen({ onBack, onHelp, onSettings, onTimerExpired, playerDeficit = 0, opponentDeficit = 0, scenario = 'None', matchType = 'Casual', playerPilots = [], opponentPilots = [] }: Props) {
  const { enableLongPress, enableActionLog, enableWakeLock, enableXwingPhases, enableXwingAlwaysIncDec, xwingTimerMinutes, setXwingTimerMinutes } = useUserSettings()
  const { isPortrait } = useOrientation()

  const [gameStarted, setGameStarted] = useState(false)
  const [pendingPlayerScenario, setPendingPlayerScenario] = useState<number | null>(null)
  const [pendingOpponentScenario, setPendingOpponentScenario] = useState<number | null>(null)
  const [playerShips, setPlayerShips] = useState<ShipEntry[]>(() => initShips(playerPilots))
  const [opponentShips, setOpponentShips] = useState<ShipEntry[]>(() => initShips(opponentPilots))
  // Phase tracker off: the round's scoring is open, between the round button and Start round.
  const [scoringOpen, setScoringOpen] = useState(false)
  // In One more round: its End ends the game again.
  const [extraRound, setExtraRound] = useState(false)
  const [gameOverReason, setGameOverReason] = useState<GameOverReason | null>(null)

  const game = useXwingGame()
  const log = useGameHistory<XwingGameSnapshot>()
  const timer = useTimer(xwingTimerMinutes * 60)
  const initiative = useInitiative()
  const phaseTracker = usePhaseTracker(XWING_PHASES)
  const [logOpen, setLogOpen] = useState(false)

  useWakeLock(enableWakeLock)

  const gameStartedRef = useRef(false)

  const atRoundEnd = enableXwingPhases ? phaseTracker.isLastPhase : scoringOpen
  const scenarioScoringActive =
    scenario !== 'None' &&
    atRoundEnd &&
    gameStarted &&
    !game.gameOver &&
    game.round >= 2

  const scenarioAlreadyScoredThisRound = log.entries.some(
    e => e.type === 'scenario' && e.snapshot.round === game.round
  )

  const snapshot = (): XwingGameSnapshot => ({
    playerScore: game.playerScore,
    opponentScore: game.opponentScore,
    playerScenarioScore: game.playerScenarioScore,
    opponentScenarioScore: game.opponentScenarioScore,
    round: game.round,
    gameStarted,
    phaseIndex: phaseTracker.phaseIndex,
    gameOver: game.gameOver,
    playerShips: [...playerShips],
    opponentShips: [...opponentShips],
    scoringOpen,
    extraRound,
    gameOverReason,
  })

  useEffect(() => {
    if (game.gameOver) {
      timer.stop()
    }
  }, [game.gameOver]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gameStarted && timer.isExpired) {
      onTimerExpired?.()
    }
  }, [gameStarted, timer.isExpired]) // eslint-disable-line react-hooks/exhaustive-deps

  const pendingScenario = (): [number, number] => scenarioScoringActive
    ? [pendingPlayerScenario ?? 0, pendingOpponentScenario ?? 0]
    : [0, 0]

  // The round's scenario points count before the result, since they were scored in it.
  const finishGame = (p: number, o: number, reason: GameOverReason) => {
    const snap = snapshot()
    if (p > 0 || o > 0) game.addScenarioPoints(p, o)
    setPendingPlayerScenario(null)
    setPendingOpponentScenario(null)
    setScoringOpen(false)
    setGameOverReason(reason)
    const finalPlayer = game.combinedPlayer + p
    const finalOpponent = game.combinedOpponent + o
    const resultMsg = finalPlayer > finalOpponent ? 'Game won'
      : finalOpponent > finalPlayer ? 'Game lost'
      : 'Draw'
    game.endGame()
    log.add({ type: 'game-result', message: resultMsg, color: '#ffffff', snapshot: snap })
  }

  const handleRoundAdvance = () => {
    if (timer.isExpired || game.gameOver || game.round >= 12) return
    const [p, o] = pendingScenario()
    // A player who reached 50 this round ends the game when the round ends, however it is ended.
    if (reachesTarget(game.combinedPlayer + p, game.combinedOpponent + o)) {
      finishGame(p, o, 'score')
      return
    }
    const fromRound = game.round
    const snap = snapshot()
    if (p > 0 || o > 0) {
      log.add({ type: 'scenario', message: 'Mission points', detail: `+${p} to you, +${o} to opponent`, color: 'var(--color-accent)', snapshot: snap })
      game.addScenarioPoints(p, o)
    }
    setPendingPlayerScenario(null)
    setPendingOpponentScenario(null)
    setScoringOpen(false)
    log.add({ type: 'round', message: `Round ${fromRound + 1}`, color: '#ffffff', snapshot: snap })
    game.advanceRound()
    if (enableXwingPhases) initiative.reset()
    phaseTracker.reset()
    void onXwingRoundAdvanced(fromRound, Math.min(12, fromRound + 1))
  }

  // The round's end: the game ends after round 12, once time has run out, or after One more round.
  const roundEndsGame = extraRound || game.round >= 12 || timer.isExpired
  const handleEndOfRound = () => {
    if (game.gameOver) return
    if (roundEndsGame) {
      const [p, o] = pendingScenario()
      const reason: GameOverReason = reachesTarget(game.combinedPlayer + p, game.combinedOpponent + o) ? 'score'
        : extraRound ? 'extra' : timer.isExpired ? 'time' : 'rounds'
      finishGame(p, o, reason)
      return
    }
    handleRoundAdvance()
  }

  const handlePhaseAdvance = () => {
    if (phaseTracker.isLastPhase) handleEndOfRound()
    else phaseTracker.advance()
  }

  const handleOpenScoring = () => {
    log.add({ type: 'scoring', message: `Scoring round ${game.round}`, color: 'var(--color-text-muted)', snapshot: snapshot() })
    setScoringOpen(true)
  }

  const resetToPregame = () => {
    log.reset()
    game.reset()
    phaseTracker.reset()
    initiative.reset()
    setPendingPlayerScenario(null)
    setPendingOpponentScenario(null)
    setPlayerShips(initShips(playerPilots))
    setOpponentShips(initShips(opponentPilots))
    setScoringOpen(false)
    setExtraRound(false)
    setGameOverReason(null)
    setLogOpen(false)
  }

  const handleStartGame = () => {
    resetToPregame()
    log.add({ type: 'round', message: 'Round 1', color: '#ffffff', snapshot: { ...snapshot(), gameStarted: false } })
    setGameStarted(true)
    gameStartedRef.current = true
    timer.start()
    void onXwingGameStarted(playerDeficit, opponentDeficit)
  }

  const playerNames = displayPilots(playerPilots).map(p => p.displayName)
  const opponentNames = displayPilots(opponentPilots).map(p => p.displayName)

  const handleShipAdvance = (side: 'player' | 'opponent', index: number, skip: boolean) => {
    if (!gameStarted || game.gameOver) return
    const ships = side === 'player' ? playerShips : opponentShips
    const setShips = side === 'player' ? setPlayerShips : setOpponentShips
    const entry = ships[index]
    if (!entry || entry.state === 'destroyed') return

    const snap = snapshot()
    const displayName = (side === 'player' ? playerNames : opponentNames)[index]
    const isHalf = entry.state === 'half'
    const pts = isHalf ? remainingPoints(entry.pilot.points) : skip ? entry.pilot.points : halfPoints(entry.pilot.points)
    const nextState: 'half' | 'destroyed' = isHalf || skip ? 'destroyed' : 'half'
    const action = nextState === 'half' ? 'damaged' : 'destroyed'
    const color = side === 'player' ? 'var(--color-error)' : 'var(--color-success)'
    const toWhom = side === 'player' ? 'to opponent' : 'to you'

    const updated = ships.map((s, i) => i === index ? { ...s, state: nextState } : s)
    const deficit = allDestroyed(updated) ? (side === 'player' ? playerDeficit : opponentDeficit) : 0

    if (pts > 0 || deficit > 0) {
      const detail = deficit > 0 ? `+${pts} and ${deficit} deficit ${toWhom}` : `+${pts} ${toWhom}`
      log.add({ type: 'score', message: `${displayName} ${action}`, detail, color, snapshot: snap })
    }
    if (side === 'player') {
      if (pts + deficit > 0) game.incrementOpponent(pts + deficit)
    } else {
      if (pts + deficit > 0) game.incrementPlayer(pts + deficit)
    }

    setShips(updated)
  }

  const handlePlayerIncrement = (n: number) => {
    log.add({ type: 'score', message: `You +${n} (${game.playerScore + n})`, color: 'var(--color-success)', snapshot: snapshot() })
    game.incrementPlayer(n)
  }

  const handlePlayerDecrement = (n: number) => {
    const next = Math.max(0, game.playerScore - n)
    log.add({ type: 'score', message: `You −${n} (${next})`, color: 'var(--color-error)', snapshot: snapshot() })
    game.decrementPlayer(n)
  }

  const handleOpponentIncrement = (n: number) => {
    log.add({ type: 'score', message: `Opp +${n} (${game.opponentScore + n})`, color: 'var(--color-error)', snapshot: snapshot() })
    game.incrementOpponent(n)
  }

  const handleOpponentDecrement = (n: number) => {
    const next = Math.max(0, game.opponentScore - n)
    log.add({ type: 'score', message: `Opp −${n} (${next})`, color: 'var(--color-success)', snapshot: snapshot() })
    game.decrementOpponent(n)
  }

  const handleLogUndo = () => {
    const entry = log.undoLast()
    if (!entry) return
    const wasGameOver = game.gameOver
    const s = entry.snapshot
    game.restoreState(s)
    setGameStarted(s.gameStarted)
    phaseTracker.restore(s.phaseIndex)
    setPlayerShips(s.playerShips)
    setOpponentShips(s.opponentShips)
    setScoringOpen(s.scoringOpen)
    setExtraRound(s.extraRound)
    setGameOverReason(s.gameOverReason)
    if (!s.gameStarted) {
      timer.reset()
      setLogOpen(false)
    } else if (wasGameOver && !s.gameOver && !timer.isExpired) {
      timer.resume()
    }
  }

  const reportGameEnded = () => {
    if (!gameStartedRef.current) return
    const elapsed_seconds = xwingTimerMinutes * 60 - timer.remaining
    void onXwingGameEnded({
      final_round: game.round,
      player_score: game.playerScore + game.playerScenarioScore,
      opponent_score: game.opponentScore + game.opponentScenarioScore,
      player_deficit: playerDeficit,
      opponent_deficit: opponentDeficit,
      result: game.result,
      elapsed_seconds,
      timer_expired: timer.isExpired,
    })
  }

  const handleBack = () => {
    reportGameEnded()
    onBack()
  }

  const handleRematch = () => {
    reportGameEnded()
    gameStartedRef.current = false
    resetToPregame()
    setGameStarted(false)
    timer.reset()
  }

  // A Casual game that ended on time or after its last round can go one round further, unless a
  // side has lost every ship.
  const canPlayOneMoreRound = game.gameOver && matchType === 'Casual'
    && (gameOverReason === 'time' || gameOverReason === 'rounds' || gameOverReason === 'extra')
    && !allDestroyed(playerShips) && !allDestroyed(opponentShips)

  const handleOneMoreRound = () => {
    log.add({ type: 'round', message: `Round ${game.round + 1}`, color: '#ffffff', snapshot: snapshot() })
    game.reopenForRound()
    phaseTracker.reset()
    if (enableXwingPhases) initiative.reset()
    setExtraRound(true)
    setGameOverReason(null)
  }

  const breakdown = (againstShips: ShipEntry[], score: number, mission: number, deficit: number): ScoreBreakdown => {
    const ships = shipPointsAgainst(againstShips)
    const deficitScored = allDestroyed(againstShips) ? deficit : 0
    return { mission, ships, deficit: deficitScored, adjustments: score - ships - deficitScored, total: score + mission }
  }

  if (isPortrait) {
    return <RotatePrompt onBack={handleBack} />
  }

  return (
    <XwingGameScreenView
      gameStarted={gameStarted}
      gameOver={game.gameOver}
      gameOverReason={gameOverReason}
      phase={phaseTracker.phase}
      onPhaseAdvance={handlePhaseAdvance}
      enableXwingPhases={enableXwingPhases}
      timerRemaining={timer.remaining}
      timerMinutes={xwingTimerMinutes}
      onTimerMinutesChange={setXwingTimerMinutes}
      round={game.round}
      roundEndsGame={roundEndsGame}
      result={game.result}
      onStartGame={handleStartGame}
      scoringOpen={scoringOpen}
      onOpenScoring={handleOpenScoring}
      onEndOfRound={handleEndOfRound}
      playerScore={game.playerScore + game.playerScenarioScore}
      opponentScore={game.opponentScore + game.opponentScenarioScore}
      onPlayerIncrement={handlePlayerIncrement}
      onPlayerDecrement={handlePlayerDecrement}
      onOpponentIncrement={handleOpponentIncrement}
      onOpponentDecrement={handleOpponentDecrement}
      enableLongPress={enableLongPress}
      enableActionLog={enableActionLog}
      enableXwingAlwaysIncDec={enableXwingAlwaysIncDec}
      logEntries={log.entries}
      logOpen={logOpen}
      onLogToggle={() => setLogOpen(o => !o)}
      onLogUndo={handleLogUndo}
      initiative={initiative.initiative}
      onInitiativeOpponent={initiative.setOpponent}
      onInitiativePlayer={initiative.setPlayer}
      onBack={handleBack}
      onHelp={onHelp}
      onSettings={onSettings}
      scenario={scenario}
      scenarioScoringActive={scenarioScoringActive}
      scenarioAlreadyScoredThisRound={scenarioAlreadyScoredThisRound}
      pendingPlayerScenario={pendingPlayerScenario}
      pendingOpponentScenario={pendingOpponentScenario}
      onPlayerScenarioSelect={(v) => setPendingPlayerScenario(v)}
      onOpponentScenarioSelect={(v) => setPendingOpponentScenario(v)}
      playerShips={playerShips}
      opponentShips={opponentShips}
      playerNames={playerNames}
      opponentNames={opponentNames}
      onPlayerShipAdvance={(i, skip) => handleShipAdvance('player', i, skip)}
      onOpponentShipAdvance={(i, skip) => handleShipAdvance('opponent', i, skip)}
      onRematch={handleRematch}
      onOneMoreRound={canPlayOneMoreRound ? handleOneMoreRound : undefined}
      playerBreakdown={breakdown(opponentShips, game.playerScore, game.playerScenarioScore, opponentDeficit)}
      opponentBreakdown={breakdown(playerShips, game.opponentScore, game.opponentScenarioScore, playerDeficit)}
    />
  )
}
