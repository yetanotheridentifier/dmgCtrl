import { useState } from 'react'

// Reaching 50 ends the game at the end of that round rather than on the spot, so points scored
// later in the round still count and both players can finish above it.
export const XWING_TARGET_SCORE = 50

export const reachesTarget = (playerTotal: number, opponentTotal: number) =>
  playerTotal >= XWING_TARGET_SCORE || opponentTotal >= XWING_TARGET_SCORE

// Scores start at 0. Deficits are not held here: the game screen adds a squad's deficit to the
// other player's score when the last of its ships is destroyed.
export function useXwingGame() {
  const [playerScore, setPlayerScore] = useState(0)
  const [opponentScore, setOpponentScore] = useState(0)
  const [playerScenarioScore, setPlayerScenarioScore] = useState(0)
  const [opponentScenarioScore, setOpponentScenarioScore] = useState(0)
  const [round, setRound] = useState(1)
  const [gameOver, setGameOver] = useState(false)

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
  const addScenarioPoints = (player: number, opponent: number) => {
    if (gameOver) return
    setPlayerScenarioScore(s => s + player)
    setOpponentScenarioScore(s => s + opponent)
  }
  const advanceRound = () => setRound(r => Math.min(12, r + 1))
  const endGame = () => setGameOver(true)
  const reset = (initialPlayerScore = 0, initialOpponentScore = 0) => {
    setPlayerScore(initialPlayerScore)
    setOpponentScore(initialOpponentScore)
    setPlayerScenarioScore(0)
    setOpponentScenarioScore(0)
    setRound(1)
    setGameOver(false)
  }
  const restoreState = (snapshot: {
    playerScore: number
    opponentScore: number
    playerScenarioScore?: number
    opponentScenarioScore?: number
    round: number
    gameOver?: boolean
  }) => {
    setPlayerScore(snapshot.playerScore)
    setOpponentScore(snapshot.opponentScore)
    setPlayerScenarioScore(snapshot.playerScenarioScore ?? 0)
    setOpponentScenarioScore(snapshot.opponentScenarioScore ?? 0)
    setRound(snapshot.round)
    setGameOver(snapshot.gameOver ?? false)
  }

  const combinedPlayer = playerScore + playerScenarioScore
  const combinedOpponent = opponentScore + opponentScenarioScore
  const result: 'win' | 'loss' | 'draw' | null = !gameOver
    ? null
    : combinedPlayer > combinedOpponent
      ? 'win'
      : combinedOpponent > combinedPlayer
        ? 'loss'
        : 'draw'

  return {
    playerScore, opponentScore, playerScenarioScore, opponentScenarioScore,
    combinedPlayer, combinedOpponent,
    round, gameOver, result,
    incrementPlayer, decrementPlayer,
    incrementOpponent, decrementOpponent,
    addScenarioPoints,
    advanceRound, endGame, reset, restoreState,
  }
}
