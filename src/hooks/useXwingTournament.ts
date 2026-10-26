import { useState } from 'react'
import type { XwingScenario } from './useXwingSetup'
import type { XwingPilot } from '../utils/parseXwsText'

const STORAGE_KEY = 'xwing_tournament'

// A list as played: a copy, so deleting it from Squad lists leaves the tournament intact.
// No list is { name: 'No list', pilots: [] } with the deficit set on setup.
export interface XwingTournamentList {
  name: string
  pilots: XwingPilot[]
  deficit: number
}

export type XwingRoundResult = 'won' | 'lost' | 'drawn'

export interface XwingTournamentRound {
  opponent: XwingTournamentList
  scenario: XwingScenario
  // Null while the round is under way.
  result: XwingRoundResult | null
  playerScore: number
  opponentScore: number
}

export interface XwingTournamentState {
  totalRounds: number
  // Your list is fixed for the tournament; the opponent and the scenario are chosen each round.
  player: XwingTournamentList
  rounds: XwingTournamentRound[]
}

// A tournament saved before rounds had their own scenario held one for every round.
type SavedTournament = XwingTournamentState & { scenario?: XwingScenario }

function load(): XwingTournamentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const { scenario = 'None', ...saved } = JSON.parse(raw) as SavedTournament
    return { ...saved, rounds: saved.rounds.map(r => ({ ...r, scenario: r.scenario ?? scenario })) }
  } catch {
    return null
  }
}

const newRound = (opponent: XwingTournamentList, scenario: XwingScenario): XwingTournamentRound =>
  ({ opponent, scenario, result: null, playerScore: 0, opponentScore: 0 })

// An X-Wing tournament: games are best of 1, so a round is one game and its result comes from the
// game's scores. Saved on every change, so it survives closing the app.
export function useXwingTournament() {
  const [tournament, setTournament] = useState<XwingTournamentState | null>(load)

  const save = (next: XwingTournamentState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setTournament(next)
  }

  const rounds = tournament?.rounds ?? []
  const roundInProgress = rounds.length > 0 && rounds[rounds.length - 1].result === null
  const isComplete = tournament !== null && rounds.length === tournament.totalRounds && !roundInProgress

  const totals = { won: 0, lost: 0, drawn: 0 }
  for (const r of rounds) if (r.result) totals[r.result]++
  // The running margin: the total of the score differences of the rounds played.
  const margin = rounds.reduce((sum, r) => sum + (r.result ? r.playerScore - r.opponentScore : 0), 0)

  // Round 1 starts with the tournament, against the opponent and with the scenario chosen on setup.
  const startTournament = (totalRounds: number, scenario: XwingScenario, player: XwingTournamentList, opponent: XwingTournamentList) => {
    save({ totalRounds, player, rounds: [newRound(opponent, scenario)] })
  }

  const startRound = (opponent: XwingTournamentList, scenario: XwingScenario) => {
    if (!tournament || roundInProgress || isComplete) return
    save({ ...tournament, rounds: [...tournament.rounds, newRound(opponent, scenario)] })
  }

  const completeRound = (result: XwingRoundResult, playerScore: number, opponentScore: number) => {
    if (!tournament || !roundInProgress) return
    const last = tournament.rounds.length - 1
    save({ ...tournament, rounds: tournament.rounds.map((r, i) => i === last ? { ...r, result, playerScore, opponentScore } : r) })
  }

  const dropTournament = () => {
    localStorage.removeItem(STORAGE_KEY)
    setTournament(null)
  }

  return { tournament, roundInProgress, isComplete, totals, margin, startTournament, startRound, completeRound, dropTournament }
}
