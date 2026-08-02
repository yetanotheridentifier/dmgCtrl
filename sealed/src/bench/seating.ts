import type { PlayerId } from '../engine/types'

/**
 * Which seat each AI takes, and who moves first, for one game of a two-AI comparison.
 *
 * Every harness used to pin `aiA` to the `player` seat and alternate only who moved first. That left
 * a real seat advantage uncancelled: an AI measured against **itself** read 49.4% to 50.0% across six
 * seeds rather than 50%. The bias is small but it is the same size as the effects being measured, so
 * every A/B needed a paired control row just to be readable.
 *
 * Seat and first player are varied on **independent** cycles. Flipping both together would be
 * balanced but useless: only two of the four combinations would ever occur, and seat advantage would
 * stay perfectly confounded with first-player advantage.
 */
export interface Seating {
  /** True when `aiA` sits in the `opponent` seat, so a result must be read from the other side. */
  swapped: boolean
  firstPlayer: PlayerId
}

/** Seat assignment for game `gameIndex`, cycling through all four combinations every four games. */
export function seating(gameIndex: number): Seating {
  return {
    swapped: gameIndex % 2 === 1,
    firstPlayer: Math.floor(gameIndex / 2) % 2 === 0 ? 'player' : 'opponent',
  }
}

/** A completed game as `aiA` experienced it. */
export interface OutcomeForA {
  won: boolean
  draw: boolean
  /** Base-damage margin in aiA's favour. */
  margin: number
}

/**
 * Re-read a game's outcome from aiA's point of view.
 *
 * `playGame` reports the winner by **seat** and a margin of `baseDamage.opponent - baseDamage.player`,
 * and both invert when aiA is swapped. The margin is the dangerous half: getting it backwards is
 * silent, because the wrong answer is still a plausible-looking number.
 */
export function resultForA(
  result: { winner: PlayerId | 'draw' | null; margin: number },
  { swapped }: Seating,
): OutcomeForA {
  const aSeat: PlayerId = swapped ? 'opponent' : 'player'
  return {
    won: result.winner === aSeat,
    draw: result.winner === 'draw',
    margin: swapped ? -result.margin : result.margin,
  }
}
