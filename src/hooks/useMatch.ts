import { useState } from 'react'
import type { PlayMode } from '../utils/playMode'

interface UseMatchResult {
  playerScore: number
  opponentScore: number
  matchOver: boolean
  incrementPlayerScore: () => void
  incrementOpponentScore: () => void
  resetMatch: () => void
  restoreState: (state: { playerScore: number; opponentScore: number }) => void
}

export function useMatch(playMode: PlayMode): UseMatchResult {
  const [playerScore, setPlayerScore] = useState(0)
  const [opponentScore, setOpponentScore] = useState(0)

  const maxScore = playMode === 'bo3' ? 2 : 1
  const matchOver = playerScore >= maxScore || opponentScore >= maxScore

  const incrementPlayerScore = () => setPlayerScore(s => Math.min(s + 1, maxScore))
  const incrementOpponentScore = () => setOpponentScore(s => Math.min(s + 1, maxScore))
  const resetMatch = () => { setPlayerScore(0); setOpponentScore(0) }
  const restoreState = (state: { playerScore: number; opponentScore: number }) => {
    setPlayerScore(state.playerScore)
    setOpponentScore(state.opponentScore)
  }

  return { playerScore, opponentScore, matchOver, incrementPlayerScore, incrementOpponentScore, resetMatch, restoreState }
}
