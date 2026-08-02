import type { GameState, PlayerId, UnitState } from '../engine/types'
import { opponentOf } from '../engine/types'
import { enemyAttackTargets } from '../engine/legalMoves'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue, unitCannotAttackBases, unitNegatesOverwhelm } from '../engine/keywords'

/**
 * The race: who gets to lethal first (#395).
 *
 * ## Why this is not board advantage
 *
 * The obvious way to ask "am I the aggressor?" is to compare board presence. Measured over 132
 * games, the side ahead on units, power and remaining HP at round 3 went on to win **49.2%** of the
 * time. That is not a weak signal, it is no signal.
 *
 * The reason is the whole point of this module: **board power is not damage that can reach a base.**
 * A control player who plays a Sentinel adds one point of power and kills nothing, yet stops the
 * opponent's clock dead. Board advantage cannot see that. The race can, and that is the shape
 * "Who's the Beatdown" is actually about.
 *
 * ## Reuse, not re-derivation
 *
 * Whether a unit's damage can reach a base is exactly the question `enemyAttackTargets`
 * (`engine/legalMoves.ts`) already answers for the rules: it resolves arena, Hidden, "cannot be
 * attacked", Saboteur and Sentinel-lock together. This module calls it rather than reimplementing
 * any of that. A second copy would drift from the rules in silence, which is precisely what #417
 * was.
 *
 * ## What this is not
 *
 * An estimate, not a simulation. It assumes every unit attacks the base every round and ignores what
 * the opponent does in between, so it will be wrong in specific positions. It is built to rank the
 * two clocks against each other cheaply, and should not be trusted beyond that. Actual lethal
 * detection is search (#425 / #410).
 */

export type Role = 'aggressor' | 'defender' | 'neutral'

/**
 * Base damage this unit contributes per round.
 *
 * Sentinel-locked means it must attack the wall, so it contributes nothing, unless it has Overwhelm,
 * which tramples the excess through to the base. The smallest reachable Sentinel is used for that,
 * since the attacker picks its target and would choose the cheapest way through.
 */
function unitReach(state: GameState, owner: PlayerId, unit: UnitState): number {
  if (unitCannotAttackBases(state, unit)) return 0
  const power = effectivePower(state, unit, { attacking: true, attackingBase: true })
  if (power <= 0) return 0

  const { targets, sentinelLocked } = enemyAttackTargets(state, unit, owner)
  if (!sentinelLocked) return power
  if (!unitHasKeyword(state, unit, 'Overwhelm')) return 0

  // Overwhelm past the softest wall that does not negate it.
  const walls = targets.filter(t => !unitNegatesOverwhelm(state, t))
  if (walls.length === 0) return 0
  const softest = Math.min(...walls.map(t => Math.max(0, effectiveHp(state, t) - t.damage)))
  return Math.max(0, power - softest)
}

const sumReach = (state: GameState, owner: PlayerId, units: UnitState[]): number =>
  units.reduce((n, u) => n + unitReach(state, owner, u), 0)

/** Base damage `owner` can land THIS round: exhausted units cannot attack again until they ready. */
export function reachThisRound(state: GameState, owner: PlayerId): number {
  return sumReach(state, owner, state.players[owner].units.filter(u => !u.exhausted))
}

/** Base damage `owner` lands in a full round once everything has readied at regroup. */
export function reachSteady(state: GameState, owner: PlayerId): number {
  return sumReach(state, owner, state.players[owner].units)
}

/** Total Restore across a player's units: healing their own base each round. */
function restorePerRound(state: GameState, owner: PlayerId): number {
  return state.players[owner].units.reduce(
    (n, u) => n + (unitHasKeyword(state, u, 'Restore') ? Math.max(1, unitKeywordValue(state, u, 'Restore')) : 0), 0)
}

/**
 * Rounds for `owner` to finish the enemy base at the current rate, `Infinity` if it never gets
 * there. Splitting this round from the steady rate is what makes it a race rather than an average:
 * exhaustion delays you by a round, it does not cost you the damage.
 */
export function clock(state: GameState, owner: PlayerId): number {
  const foe = opponentOf(owner)
  const theirBase = state.players[foe].base
  const remaining = (state.cards[theirBase.cardId]?.hp ?? 30) - theirBase.damage
  if (remaining <= 0) return 0

  const now = reachThisRound(state, owner)
  if (now >= remaining) return 1

  // They heal between your swings, so Restore comes off your effective rate.
  const perRound = reachSteady(state, owner) - restorePerRound(state, foe)
  if (perRound <= 0) return Infinity
  return 1 + Math.ceil((remaining - now) / perRound)
}

/**
 * Can `seat` finish the enemy base with what it already has ready?
 *
 * A clock of 1 is exactly that statement, so this is a name for a reading rather than a second
 * damage calculation, and it inherits the race model's targeting for free: Sentinel, Saboteur, arena
 * and Hidden all resolve through the rules' own function, so a wall in the way correctly makes it
 * false.
 *
 * **An approximation, deliberately.** It sees damage that can already connect, so it under-counts a
 * line needing a card played first, an event finisher, or a when-played trigger. That is the right
 * trade for a sizing instrument: it answers "how often could a lethal rule ever fire" for the price
 * of a comparison, and #433's one-turn solver replaces it with a real search.
 */
export function canFinishNow(state: GameState, seat: PlayerId): boolean {
  return clock(state, seat) === 1
}

/**
 * Who is the beatdown, read off the live board. Integer rounds give a natural deadband: the role
 * only moves when the clocks genuinely separate, so a single point of damage cannot flip it.
 *
 * Complementary by construction: a shorter clock for one seat is a longer clock for the other, so
 * both sides can never think they are the aggressor.
 */
export function role(state: GameState, owner: PlayerId): Role {
  const mine = clock(state, owner)
  const theirs = clock(state, opponentOf(owner))
  if (mine === theirs) return 'neutral'
  return mine < theirs ? 'aggressor' : 'defender'
}
