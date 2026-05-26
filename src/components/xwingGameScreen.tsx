import { useState, useRef, useEffect } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useUserSettings } from '../hooks/useUserSettings'
import { useXwingGame } from '../hooks/useXwingGame'
import { useGameHistory } from '../hooks/useGameHistory'
import { useTimer } from '../hooks/useTimer'
import { useWakeLock } from '../hooks/useWakeLock'
import XwingGameScreenView from './xwingGameScreenView'
import RotatePrompt from './layout/rotatePrompt'
import { onXwingGameStarted, onXwingGameEnded, onXwingRoundAdvanced } from '../services/analytics'

interface XwingGameSnapshot {
  playerScore: number
  opponentScore: number
  round: number
  gameStarted: boolean
}

interface Props {
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onGameEnd?: () => void
  onTimerExpired?: () => void
}

export default function XwingGameScreen({ onBack, onHelp, onSettings, onGameEnd, onTimerExpired }: Props) {
  const { enableLongPress, enableActionLog, enableWakeLock, xwingTimerMinutes } = useUserSettings()
  const { isPortrait } = useOrientation()

  const [playerDeficit, setPlayerDeficit] = useState(0)
  const [opponentDeficit, setOpponentDeficit] = useState(0)
  const [gameStarted, setGameStarted] = useState(false)

  const game = useXwingGame()
  const log = useGameHistory<XwingGameSnapshot>()
  const timer = useTimer(xwingTimerMinutes * 60)
  const [logOpen, setLogOpen] = useState(false)

  useWakeLock(enableWakeLock)

  const gameStartedRef = useRef(false)

  const snapshot = (): XwingGameSnapshot => ({
    playerScore: game.playerScore,
    opponentScore: game.opponentScore,
    round: game.round,
    gameStarted,
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

  useEffect(() => {
    if (game.round === 12) {
      timer.stop()
    }
  }, [game.round]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoundAdvance = () => {
    if (timer.isExpired || game.gameOver || game.round >= 12) return
    const fromRound = game.round
    log.add({ type: 'round', message: `Round ${fromRound + 1}`, color: '#ffffff', snapshot: snapshot() })
    game.advanceRound()
    void onXwingRoundAdvanced(fromRound, Math.min(12, fromRound + 1))
  }

  const handleStartGame = () => {
    log.reset()
    setLogOpen(false)
    log.add({ type: 'round', message: 'Round 1', color: '#ffffff', snapshot: snapshot() })
    game.reset()
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
    game.restoreState(entry.snapshot)
    setGameStarted(entry.snapshot.gameStarted)
    if (!entry.snapshot.gameStarted) {
      timer.reset()
    }
  }

  const handleBack = () => {
    if (gameStartedRef.current) {
      const elapsed_seconds = xwingTimerMinutes * 60 - timer.remaining
      void onXwingGameEnded({
        final_round: game.round,
        player_score: game.playerScore,
        opponent_score: game.opponentScore,
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
      timerRemaining={timer.remaining}
      timerExpired={timer.isExpired}
      round={game.round}
      result={game.result}
      playerDeficit={playerDeficit}
      opponentDeficit={opponentDeficit}
      onPlayerDeficitIncrement={(n) => setPlayerDeficit(d => Math.min(4, d + n))}
      onPlayerDeficitDecrement={(n) => setPlayerDeficit(d => Math.max(0, d - n))}
      onOpponentDeficitIncrement={(n) => setOpponentDeficit(d => Math.min(4, d + n))}
      onOpponentDeficitDecrement={(n) => setOpponentDeficit(d => Math.max(0, d - n))}
      onStartGame={handleStartGame}
      onRoundAdvance={handleRoundAdvance}
      playerScore={game.playerScore}
      opponentScore={game.opponentScore}
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
      onBack={handleBack}
      onHelp={onHelp}
      onSettings={onSettings}
      onGameEnd={onGameEnd}
    />
  )
}
