import type { MatchResult } from '../hooks/useMatch'

// A Twin Suns game for 3 or 4 players on one device. Players are numbered as they sit: 0 is you
// (top left), then the opponents in seat order. Every function returns a new state and leaves the
// one it was given alone, so a snapshot of it is the undo.

export type Counter = 'initiative' | 'plan' | 'blast'

export interface TwinSunsState {
  round: number
  damage: number[]
  epicUsed: boolean[]
  // Who holds each counter: initiative stays across rounds; Plan and Blast return at Round.
  initiative: number | null
  plan: number | null
  blast: number | null
  // Destroyed: out of the game, and taking no input.
  out: boolean[]
  // Destroyed bases still waiting to be told who destroyed them, first in line first.
  pending: number[]
  // The base just healed 5 for destroying one, until the next action.
  healed: number | null
  finished: boolean
}

export const BLAST_DAMAGE = 1
export const DESTROY_HEAL = 5

export function startState(players: number): TwinSunsState {
  return {
    round: 1,
    damage: Array(players).fill(0),
    epicUsed: Array(players).fill(false),
    initiative: null,
    plan: null,
    blast: null,
    out: Array(players).fill(false),
    pending: [],
    healed: null,
    finished: false,
  }
}

const set = <T>(xs: T[], i: number, x: T) => xs.map((v, j) => (j === i ? x : v))

// Damage on bases still in, each kept within its HP; a base reaching its HP is out and waits.
function damageMany(s: TwinSunsState, hp: number[], amounts: number[]): TwinSunsState {
  const damage = s.damage.map((d, i) => (s.out[i] ? d : Math.min(hp[i], d + amounts[i])))
  const destroyed = damage.map((_, i) => i).filter(i => !s.out[i] && damage[i] >= hp[i])
  return {
    ...s,
    damage,
    out: s.out.map((o, i) => o || destroyed.includes(i)),
    pending: [...s.pending, ...destroyed],
    healed: null,
  }
}

export function addDamage(s: TwinSunsState, hp: number[], i: number, n: number): TwinSunsState {
  if (s.out[i]) return s
  return damageMany(s, hp, s.damage.map((_, j) => (j === i ? n : 0)))
}

export function removeDamage(s: TwinSunsState, i: number, n: number): TwinSunsState {
  if (s.out[i]) return s
  return { ...s, damage: set(s.damage, i, Math.max(0, s.damage[i] - n)), healed: null }
}

export function setEpicUsed(s: TwinSunsState, i: number, used: boolean): TwinSunsState {
  return { ...s, epicUsed: set(s.epicUsed, i, used), healed: null }
}

// Blast also deals its damage to every other base at once.
export function claim(s: TwinSunsState, hp: number[], counter: Counter, i: number): TwinSunsState {
  const claimed = { ...s, [counter]: i, healed: null }
  if (counter !== 'blast') return claimed
  return damageMany(claimed, hp, s.damage.map((_, j) => (j === i ? 0 : BLAST_DAMAGE)))
}

export function nextRound(s: TwinSunsState): TwinSunsState {
  return { ...s, round: s.round + 1, plan: null, blast: null, healed: null }
}

// The first base waiting is settled: the player who destroyed it heals, or no one does.
export function resolveDestroyed(s: TwinSunsState, by: number | null): TwinSunsState {
  const rest = { ...s, pending: s.pending.slice(1), healed: null }
  if (by === null) return rest
  return { ...rest, damage: set(s.damage, by, Math.max(0, s.damage[by] - DESTROY_HEAL)), healed: by }
}

export function finish(s: TwinSunsState): TwinSunsState {
  return { ...s, finished: true, pending: [], healed: null }
}

// Once a base is out, the game ends at the end of that phase.
export const lastPhase = (s: TwinSunsState) => !s.finished && s.out.some(Boolean)

export interface Placing {
  // 1 for most HP left; tied bases share a place. Null for a base that is out.
  place: number | null
  hpLeft: number
  label: string
}

const ORDINAL = ['1st', '2nd', '3rd', '4th']

// Each player's place, in player order: most HP left wins, and a tie for most is a draw.
export function placings(s: TwinSunsState, hp: number[]): Placing[] {
  const left = s.damage.map((d, i) => hp[i] - d)
  const inGame = left.filter((_, i) => !s.out[i])
  const best = Math.max(...inGame)
  const tiedFirst = inGame.filter(h => h === best).length > 1
  return left.map((hpLeft, i) => {
    if (s.out[i]) return { place: null, hpLeft: 0, label: 'Out' }
    const place = 1 + inGame.filter(h => h > hpLeft).length
    const label = place === 1 ? `1st · ${tiedFirst ? 'Draw' : 'Won'}` : ORDINAL[place - 1]
    return { place, hpLeft, label }
  })
}

// The result from your side (player 0), as a one- or two-player game records it.
export function yourResult(s: TwinSunsState, hp: number[]): MatchResult {
  const yours = placings(s, hp)[0]
  if (yours.place !== 1) return 'lost'
  return yours.label.endsWith('Draw') ? 'drawn' : 'won'
}
