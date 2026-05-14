import { useState } from 'react'
import type { PlayMode } from '../utils/playMode'

export type MatchResult = 'won' | 'lost' | 'drawn'

interface UseMatchResult {
  playerScore: number
  opponentScore: number
  matchOver: boolean
  matchResult: MatchResult | null
  incrementPlayerScore: () => void
  incrementOpponentScore: () => void
  recordDraw: () => void
  closeByTimer: () => void
  resetMatch: () => void
  restoreState: (state: { playerScore: number; opponentScore: number; matchDrawn?: boolean; matchClosedByTimer?: boolean }) => void
}

export function useMatch(playMode: PlayMode): UseMatchResult {
  const [playerScore, setPlayerScore] = useState(0)
  const [opponentScore, setOpponentScore] = useState(0)
  const [matchDrawn, setMatchDrawn] = useState(false)
  const [matchClosedByTimer, setMatchClosedByTimer] = useState(false)

  const maxScore = playMode === 'bo3' ? 2 : 1
  const matchOver = playerScore >= maxScore || opponentScore >= maxScore || matchDrawn || matchClosedByTimer

  const getEarlyCloseResult = (ps: number, os: number): MatchResult =>
    ps > os ? 'won' : os > ps ? 'lost' : 'drawn'

  let matchResult: MatchResult | null = null
  if (playerScore >= maxScore) matchResult = 'won'
  else if (opponentScore >= maxScore) matchResult = 'lost'
  else if (matchDrawn || matchClosedByTimer) matchResult = getEarlyCloseResult(playerScore, opponentScore)

  const incrementPlayerScore = () => setPlayerScore(s => Math.min(s + 1, maxScore))
  const incrementOpponentScore = () => setOpponentScore(s => Math.min(s + 1, maxScore))
  const recordDraw = () => setMatchDrawn(true)
  const closeByTimer = () => setMatchClosedByTimer(true)

  const resetMatch = () => {
    setPlayerScore(0)
    setOpponentScore(0)
    setMatchDrawn(false)
    setMatchClosedByTimer(false)
  }

  const restoreState = (state: { playerScore: number; opponentScore: number; matchDrawn?: boolean; matchClosedByTimer?: boolean }) => {
    setPlayerScore(state.playerScore)
    setOpponentScore(state.opponentScore)
    setMatchDrawn(state.matchDrawn ?? false)
    setMatchClosedByTimer(state.matchClosedByTimer ?? false)
  }

  return { playerScore, opponentScore, matchOver, matchResult, incrementPlayerScore, incrementOpponentScore, recordDraw, closeByTimer, resetMatch, restoreState }
}
