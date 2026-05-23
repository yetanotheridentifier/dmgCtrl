import { useState, useRef } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useUserSettings } from '../hooks/useUserSettings'
import { useXwingGame } from '../hooks/useXwingGame'
import XwingGameScreenView from './xwingGameScreenView'
import RotatePrompt from './layout/RotatePrompt'
import { onXwingGameStarted, onXwingGameEnded } from '../services/analytics'

interface Props {
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onGameEnd?: () => void
}

export default function XwingGameScreen({ onBack, onHelp, onSettings, onGameEnd }: Props) {
  const { enableLongPress, enableActionLog } = useUserSettings()
  const { isPortrait } = useOrientation()

  const [playerDeficit, setPlayerDeficit] = useState(0)
  const [opponentDeficit, setOpponentDeficit] = useState(0)
  const [gameStarted, setGameStarted] = useState(false)

  const game = useXwingGame()

  const gameStartedRef = useRef(false)

  const handleStartGame = () => {
    game.reset()
    setGameStarted(true)
    gameStartedRef.current = true
    void onXwingGameStarted(playerDeficit, opponentDeficit)
  }

  const handleBack = () => {
    if (gameStartedRef.current) {
      void onXwingGameEnded({
        final_round: game.round,
        player_score: game.playerScore,
        opponent_score: game.opponentScore,
        player_deficit: playerDeficit,
        opponent_deficit: opponentDeficit,
        result: game.result,
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
