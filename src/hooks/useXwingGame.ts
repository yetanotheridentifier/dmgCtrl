import { useState } from 'react'

// Deficits are accepted by the parent component and stored separately.
// They will be applied to the score when the opponent's ships are destroyed
// (future ticket). The hook operates with scores starting at 0.
export function useXwingGame() {
  const [playerScore, setPlayerScore] = useState(0)
  const [opponentScore, setOpponentScore] = useState(0)
  const [round, setRound] = useState(1)

  const gameOver =
    playerScore >= 50 || opponentScore >= 50

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
  const reset = () => {
    setPlayerScore(0)
    setOpponentScore(0)
    setRound(1)
  }

  const result: 'win' | 'loss' | 'draw' | null = !gameOver
    ? null
    : playerScore >= 50 && opponentScore >= 50
      ? 'draw'
      : playerScore >= 50
        ? 'win'
        : 'loss'

  return {
    playerScore, opponentScore, round, gameOver, result,
    incrementPlayer, decrementPlayer,
    incrementOpponent, decrementOpponent,
    advanceRound, reset,
  }
}
