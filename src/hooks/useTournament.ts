import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Base } from './useBases'
import type { Format } from '../utils/formatFilter'

const STORAGE_KEY = 'tournament_state'

export interface TournamentRound {
  roundNumber: number
  playerScore: number
  opponentScore: number
  result: 'won' | 'lost' | 'drawn' | null
  submitted: boolean
}

export interface TournamentState {
  base: Base
  format: Format
  tournamentId: string
  playMode: 'bo1' | 'bo3'
  totalRounds: number
  rounds: TournamentRound[]
}

function load(): TournamentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as TournamentState
  } catch {
    return null
  }
}

function persist(state: TournamentState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function update(
  setState: Dispatch<SetStateAction<TournamentState | null>>,
  next: TournamentState,
): void {
  persist(next)
  setState(next)
}

export function useTournament() {
  const [tournament, setTournament] = useState<TournamentState | null>(load)

  const matchInProgress =
    tournament !== null &&
    tournament.rounds.length > 0 &&
    tournament.rounds[tournament.rounds.length - 1].result === null

  const isComplete =
    tournament !== null &&
    tournament.rounds.length === tournament.totalRounds &&
    tournament.rounds.every(r => r.result !== null)

  const totals = (tournament?.rounds ?? []).reduce(
    (acc, r) => {
      if (r.result === 'won') acc.won++
      else if (r.result === 'lost') acc.lost++
      else if (r.result === 'drawn') acc.drawn++
      return acc
    },
    { won: 0, lost: 0, drawn: 0 },
  )

  const points = totals.won * 3 + totals.drawn

  const startTournament = (
    base: Base,
    format: Format,
    tournamentId: string,
    playMode: 'bo1' | 'bo3',
    totalRounds: number,
  ) => {
    const next: TournamentState = { base, format, tournamentId, playMode, totalRounds, rounds: [] }
    update(setTournament, next)
  }

  const startMatch = () => {
    setTournament(prev => {
      if (!prev) return prev
      const isInProgress = prev.rounds.length > 0 && prev.rounds[prev.rounds.length - 1].result === null
      if (isInProgress) return prev
      const round: TournamentRound = {
        roundNumber: prev.rounds.length + 1,
        playerScore: 0,
        opponentScore: 0,
        result: null,
        submitted: false,
      }
      const next = { ...prev, rounds: [...prev.rounds, round] }
      persist(next)
      return next
    })
  }

  const completeMatch = (result: 'won' | 'lost' | 'drawn', playerScore: number, opponentScore: number) => {
    if (!tournament || !matchInProgress) return
    const rounds = tournament.rounds.map((r, i) =>
      i === tournament.rounds.length - 1 ? { ...r, result, playerScore, opponentScore } : r,
    )
    update(setTournament, { ...tournament, rounds })
  }

  const submitRound = () => {
    if (!tournament) return
    const last = tournament.rounds[tournament.rounds.length - 1]
    if (!last || last.result === null) return
    const rounds = tournament.rounds.map((r, i) =>
      i === tournament.rounds.length - 1 ? { ...r, submitted: true } : r,
    )
    update(setTournament, { ...tournament, rounds })
  }

  const dropTournament = () => {
    localStorage.removeItem(STORAGE_KEY)
    setTournament(null)
  }

  const setTournamentId = (id: string) => {
    if (!tournament) return
    update(setTournament, { ...tournament, tournamentId: id })
  }

  return {
    tournament,
    matchInProgress,
    isComplete,
    totals,
    points,
    startTournament,
    startMatch,
    completeMatch,
    submitRound,
    dropTournament,
    setTournamentId,
  }
}
