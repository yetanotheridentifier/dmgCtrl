import { useState, useRef, useEffect } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useUserSettings } from '../hooks/useUserSettings'
import { useXwingGame } from '../hooks/useXwingGame'
import { useGameHistory } from '../hooks/useGameHistory'
import { useTimer } from '../hooks/useTimer'
import { useWakeLock } from '../hooks/useWakeLock'
import { useInitiative } from '../hooks/useInitiative'
import { usePhaseTracker, XWING_PHASES } from '../hooks/usePhaseTracker'
import XwingGameScreenView from './xwingGameScreenView'
import RotatePrompt from './layout/rotatePrompt'
import { onXwingGameStarted, onXwingGameEnded, onXwingRoundAdvanced } from '../services/analytics'
import type { XwingScenario } from '../hooks/useXwingSetup'
import type { XwingPilot } from '../utils/parseXwsText'

interface XwingGameSnapshot {
  playerScore: number
  opponentScore: number
  playerScenarioScore: number
  opponentScenarioScore: number
  round: number
  gameStarted: boolean
  phaseIndex: number
  gameEnded: boolean
}

interface Props {
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onGameEnd?: () => void
  onTimerExpired?: () => void
  playerDeficit?: number
  opponentDeficit?: number
  scenario?: XwingScenario
  playerPilots?: XwingPilot[]
  opponentPilots?: XwingPilot[]
}

export default function XwingGameScreen({ onBack, onHelp, onSettings, onGameEnd, onTimerExpired, playerDeficit = 0, opponentDeficit = 0, scenario = 'None', playerPilots, opponentPilots }: Props) {
  const { enableLongPress, enableActionLog, enableWakeLock, enableInitiativeBar, enableXwingPhases, xwingTimerMinutes } = useUserSettings()
  const { isPortrait } = useOrientation()

  const [gameStarted, setGameStarted] = useState(false)
  const [pendingPlayerScenario, setPendingPlayerScenario] = useState<number | null>(null)
  const [pendingOpponentScenario, setPendingOpponentScenario] = useState<number | null>(null)

  const game = useXwingGame()
  const log = useGameHistory<XwingGameSnapshot>()
  const timer = useTimer(xwingTimerMinutes * 60)
  const initiative = useInitiative()
  const phaseTracker = usePhaseTracker(XWING_PHASES)
  const [logOpen, setLogOpen] = useState(false)

  useWakeLock(enableWakeLock)

  const gameStartedRef = useRef(false)

  const scenarioScoringActive =
    scenario !== 'None' &&
    enableXwingPhases &&
    phaseTracker.isLastPhase &&
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
    gameEnded: game.gameEnded,
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

  const handleRoundAdvance = () => {
    if (timer.isExpired || game.gameOver || game.round >= 12) return
    const p = scenarioScoringActive ? (pendingPlayerScenario ?? 0) : 0
    const o = scenarioScoringActive ? (pendingOpponentScenario ?? 0) : 0
    const fromRound = game.round
    const snap = snapshot()
    if (p > 0 || o > 0) {
      log.add({ type: 'scenario', message: `Scenario: You +${p}, Opp +${o}`, color: 'var(--color-accent)', snapshot: snap })
      game.addScenarioPoints(p, o)
    }
    setPendingPlayerScenario(null)
    setPendingOpponentScenario(null)
    log.add({ type: 'round', message: `Round ${fromRound + 1}`, color: '#ffffff', snapshot: snap })
    game.advanceRound()
    initiative.reset()
    phaseTracker.reset()
    void onXwingRoundAdvanced(fromRound, Math.min(12, fromRound + 1))
  }

  const handlePhaseAdvance = () => {
    if (phaseTracker.isLastPhase) {
      if (game.round >= 12 || timer.isExpired) {
        const p = scenarioScoringActive ? (pendingPlayerScenario ?? 0) : 0
        const o = scenarioScoringActive ? (pendingOpponentScenario ?? 0) : 0
        const snap = snapshot()
        if (p > 0 || o > 0) game.addScenarioPoints(p, o)
        setPendingPlayerScenario(null)
        setPendingOpponentScenario(null)
        const finalPlayer = game.playerScore + game.playerScenarioScore + p
        const finalOpponent = game.opponentScore + game.opponentScenarioScore + o
        const resultMsg = finalPlayer > finalOpponent ? 'Game Won'
          : finalOpponent > finalPlayer ? 'Game Lost'
          : 'Draw'
        game.endGame()
        log.add({ type: 'game-result', message: resultMsg, color: '#ffffff', snapshot: snap })
        return
      }
      handleRoundAdvance()
    } else {
      phaseTracker.advance()
    }
  }

  const handleStartGame = () => {
    log.reset()
    setLogOpen(false)
    log.add({ type: 'round', message: 'Round 1', color: '#ffffff', snapshot: snapshot() })
    game.reset(opponentDeficit, playerDeficit)
    phaseTracker.reset()
    setPendingPlayerScenario(null)
    setPendingOpponentScenario(null)
    setGameStarted(true)
    gameStartedRef.current = true
    timer.start()
    void onXwingGameStarted(playerDeficit, opponentDeficit)
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
    game.restoreState(entry.snapshot)
    setGameStarted(entry.snapshot.gameStarted)
    phaseTracker.restore(entry.snapshot.phaseIndex)
    const snapshotGameOver =
      (entry.snapshot.playerScore + (entry.snapshot.playerScenarioScore ?? 0)) >= 50 ||
      (entry.snapshot.opponentScore + (entry.snapshot.opponentScenarioScore ?? 0)) >= 50 ||
      (entry.snapshot.gameEnded ?? false)
    if (!entry.snapshot.gameStarted) {
      timer.reset()
    } else if (wasGameOver && !snapshotGameOver && !timer.isExpired) {
      timer.resume()
    }
  }

  const handleBack = () => {
    if (gameStartedRef.current) {
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
    onBack()
  }

  if (isPortrait) {
    return <RotatePrompt onBack={handleBack} />
  }

  return (
    <XwingGameScreenView
      gameStarted={gameStarted}
      gameOver={game.gameOver}
      phase={phaseTracker.phase}
      onPhaseAdvance={handlePhaseAdvance}
      enableXwingPhases={enableXwingPhases}
      timerRemaining={timer.remaining}
      timerExpired={timer.isExpired}
      round={game.round}
      result={game.result}
      onStartGame={handleStartGame}
      onRoundAdvance={handleRoundAdvance}
      playerScore={game.playerScore + game.playerScenarioScore}
      opponentScore={game.opponentScore + game.opponentScenarioScore}
      playerDeficit={playerDeficit}
      opponentDeficit={opponentDeficit}
      onPlayerIncrement={handlePlayerIncrement}
      onPlayerDecrement={handlePlayerDecrement}
      onOpponentIncrement={handleOpponentIncrement}
      onOpponentDecrement={handleOpponentDecrement}
      enableLongPress={enableLongPress}
      enableActionLog={enableActionLog}
      logEntries={log.entries}
      logOpen={logOpen}
      onLogToggle={() => setLogOpen(o => !o)}
      onLogUndo={handleLogUndo}
      enableInitiativeBar={enableInitiativeBar}
      initiative={initiative.initiative}
      onInitiativeOpponent={initiative.setOpponent}
      onInitiativePlayer={initiative.setPlayer}
      onBack={handleBack}
      onHelp={onHelp}
      onSettings={onSettings}
      onGameEnd={onGameEnd}
      scenario={scenario}
      scenarioScoringActive={scenarioScoringActive}
      scenarioAlreadyScoredThisRound={scenarioAlreadyScoredThisRound}
      pendingPlayerScenario={pendingPlayerScenario}
      pendingOpponentScenario={pendingOpponentScenario}
      onPlayerScenarioSelect={(v) => setPendingPlayerScenario(v)}
      onOpponentScenarioSelect={(v) => setPendingOpponentScenario(v)}
      playerPilots={playerPilots}
      opponentPilots={opponentPilots}
    />
  )
}
