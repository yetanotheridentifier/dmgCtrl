import { useState } from 'react'

// Deficits are accepted by the parent component and stored separately.
// They will be applied to the score when the opponent's ships are destroyed
// (future ticket). The hook operates with scores starting at 0.
export function useXwingGame() {
  const [playerScore, setPlayerScore] = useState(0)
  const [opponentScore, setOpponentScore] = useState(0)
  const [round, setRound] = useState(1)
  const [gameEnded, setGameEnded] = useState(false)

  const gameOver =
    playerScore >= 50 || opponentScore >= 50 || gameEnded

  const incrementPlayer = (n: number) => {
    if (gameOver) return
    setPlayerScore(s => s + n)
  }
  const decrementPlayer = (n: number) => {
    if (gameOver) return
    setPlayerScore(s => Math.max(0, s - n))
  }
  const incrementOpponent = (n: number) => {
    if (gameOver) return
    setOpponentScore(s => s + n)
  }
  const decrementOpponent = (n: number) => {
    if (gameOver) return
    setOpponentScore(s => Math.max(0, s - n))
  }
  const advanceRound = () => setRound(r => Math.min(12, r + 1))
  const endGame = () => setGameEnded(true)
  const reset = (initialPlayerScore = 0, initialOpponentScore = 0) => {
    setPlayerScore(initialPlayerScore)
    setOpponentScore(initialOpponentScore)
    setRound(1)
    setGameEnded(false)
  }
  const restoreState = (snapshot: { playerScore: number; opponentScore: number; round: number; gameEnded?: boolean }) => {
    setPlayerScore(snapshot.playerScore)
    setOpponentScore(snapshot.opponentScore)
    setRound(snapshot.round)
    setGameEnded(snapshot.gameEnded ?? false)
  }

  const result: 'win' | 'loss' | 'draw' | null = !gameOver
    ? null
    : playerScore > opponentScore
      ? 'win'
      : opponentScore > playerScore
        ? 'loss'
        : 'draw'

  return {
    playerScore, opponentScore, round, gameOver, gameEnded, result,
    incrementPlayer, decrementPlayer,
    incrementOpponent, decrementOpponent,
    advanceRound, endGame, reset, restoreState,
  }
}
