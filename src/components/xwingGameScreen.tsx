import { useState, useRef, useEffect } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useUserSettings } from '../hooks/useUserSettings'
import { useXwingGame } from '../hooks/useXwingGame'
import { useTimer } from '../hooks/useTimer'
import { useWakeLock } from '../hooks/useWakeLock'
import XwingGameScreenView from './xwingGameScreenView'
import RotatePrompt from './layout/RotatePrompt'
import { onXwingGameStarted, onXwingGameEnded } from '../services/analytics'

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
  const timer = useTimer(xwingTimerMinutes * 60)

  useWakeLock(enableWakeLock)

  const gameStartedRef = useRef(false)

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

  const handleStartGame = () => {
    game.reset()
    setGameStarted(true)
    gameStartedRef.current = true
    timer.start()
    void onXwingGameStarted(playerDeficit, opponentDeficit)
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
      result={game.result}
      playerDeficit={playerDeficit}
      opponentDeficit={opponentDeficit}
      onPlayerDeficitIncrement={(n) => setPlayerDeficit(d => Math.min(4, d + n))}
      onPlayerDeficitDecrement={(n) => setPlayerDeficit(d => Math.max(0, d - n))}
      onOpponentDeficitIncrement={(n) => setOpponentDeficit(d => Math.min(4, d + n))}
      onOpponentDeficitDecrement={(n) => setOpponentDeficit(d => Math.max(0, d - n))}
      onStartGame={handleStartGame}
      playerScore={game.playerScore}
      opponentScore={game.opponentScore}
      onPlayerIncrement={game.incrementPlayer}
      onPlayerDecrement={game.decrementPlayer}
      onOpponentIncrement={game.incrementOpponent}
      onOpponentDecrement={game.decrementOpponent}
      enableLongPress={enableLongPress}
      enableActionLog={enableActionLog}
      onBack={handleBack}
      onHelp={onHelp}
      onSettings={onSettings}
      onGameEnd={onGameEnd}
    />
  )
}
